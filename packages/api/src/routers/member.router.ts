import { TRPCError } from "@trpc/server";
import { type DatabaseExecutor, db } from "@upstand/db";
import { member, organization, user } from "@upstand/db/schema/auth";
import { customRole } from "@upstand/db/schema/custom-role";
import { notificationChannel } from "@upstand/db/schema/notification";
import {
  capabilitiesForRole,
  MEMBER_SCOPE_ACTIONS,
  MemberPermissionsSchema,
  parseCapabilities,
} from "@upstand/domain";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "../auth";
import {
  protectedProcedure,
  router,
  twoFactorVerifiedProcedure,
} from "../index";
import {
  checkPermission,
  type PermissionAction,
  ROLE_PERMISSIONS,
} from "../permissions";

const permissionActions = MEMBER_SCOPE_ACTIONS as [
  PermissionAction,
  ...PermissionAction[],
];
const permissionsSchema = MemberPermissionsSchema;
const baseInput = z.object({ organizationId: z.string().min(1) });

function parseStoredPermissions(value: string): PermissionAction[] {
  try {
    return parseCapabilities(JSON.parse(value)).filter((permission) =>
      permissionActions.includes(permission),
    );
  } catch {
    return [];
  }
}

function assertManager(actorRole: string, targetRole?: string) {
  if (actorRole === "owner") return;
  if (
    actorRole === "admin" &&
    (!targetRole || targetRole === "member" || targetRole.startsWith("custom:"))
  )
    return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Only workspace owners and admins can manage members",
  });
}

async function resolveRoleAssignment(
  db: DatabaseExecutor,
  organizationId: string,
  role: "member" | "admin",
  permissions: PermissionAction[],
  customRoleId?: string | null,
  actorRole?: string,
) {
  if (!customRoleId) {
    validatePermissions(role, permissions);
    return { role, permissions };
  }
  const selected = await db
    .select()
    .from(customRole)
    .where(
      and(
        eq(customRole.id, customRoleId),
        eq(customRole.organizationId, organizationId),
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);
  if (!selected)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Custom role not found",
    });
  const selectedPermissions = parseStoredPermissions(selected.permissions);
  const allowed = new Set(
    actorRole === "owner"
      ? permissionActions
      : capabilitiesForRole(actorRole || "member"),
  );
  if (selectedPermissions.some((permission) => !allowed.has(permission))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You cannot assign a custom role with elevated permissions",
    });
  }
  return {
    role: `custom:${selected.id}`,
    permissions: selectedPermissions,
  };
}

function validatePermissions(role: string, permissions: PermissionAction[]) {
  const allowed = new Set(
    ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS] || [],
  );
  if (permissions.some((permission) => !allowed.has(permission))) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Permissions exceed the selected ${role} role`,
    });
  }
}

export const memberRouter = router({
  list: protectedProcedure.input(baseInput).query(async ({ ctx, input }) => {
    await checkPermission(
      ctx.session.user.id,
      input.organizationId,
      "member:view",
    );
    const rows = await db
      .select({ member, user })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, input.organizationId));
    return {
      members: rows.map(({ member: membership, user: memberUser }) => ({
        ...membership,
        permissions: membership.permissions
          ? parseStoredPermissions(membership.permissions)
          : null,
        user: memberUser,
      })),
    };
  }),

  create: twoFactorVerifiedProcedure
    .input(
      baseInput.extend({
        name: z.string().trim().min(1).max(120),
        email: z.email(),
        password: z.string().min(8).max(200),
        role: z.enum(["member", "admin"]),
        permissions: permissionsSchema,
        customRoleId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actor = await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "member:manage",
      );
      assertManager(actor.role);
      if (actor.role === "admin" && input.role !== "member") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admins can only create members",
        });
      }
      const assignment = await resolveRoleAssignment(
        db,
        input.organizationId,
        input.role,
        input.permissions,
        input.customRoleId,
        actor.role,
      );
      const email = input.email.trim().toLowerCase();
      const existing = await db
        .select({ id: member.id })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(
            eq(member.organizationId, input.organizationId),
            eq(user.email, email),
          ),
        )
        .limit(1);
      if (existing.length)
        throw new TRPCError({
          code: "CONFLICT",
          message: "This user is already a workspace member",
        });

      const created = await auth.api.createUser({
        body: {
          email,
          name: input.name,
          password: input.password,
          role: "user",
          data: { managed: true },
        },
      });
      try {
        await db.transaction(async (tx) => {
          await tx.insert(member).values({
            id: crypto.randomUUID(),
            organizationId: input.organizationId,
            userId: created.user.id,
            role: assignment.role,
            permissions: JSON.stringify(assignment.permissions),
            createdAt: new Date(),
          });

          const personalWorkspaces = await tx
            .select({ id: organization.id, metadata: organization.metadata })
            .from(member)
            .innerJoin(organization, eq(member.organizationId, organization.id))
            .where(eq(member.userId, created.user.id));
          for (const workspace of personalWorkspaces) {
            if (workspace.metadata === JSON.stringify({ isPersonal: true })) {
              await tx
                .delete(organization)
                .where(eq(organization.id, workspace.id));
            }
          }
        });
      } catch (error) {
        await db
          .delete(user)
          .where(eq(user.id, created.user.id))
          .catch((cleanupError) => {
            ctx.log.error(
              cleanupError instanceof Error
                ? cleanupError
                : String(cleanupError),
              {
                message:
                  "Failed to clean up user after membership creation failed",
                userId: created.user.id,
              },
            );
          });
        throw error;
      }
      return { user: created.user };
    }),

  invite: twoFactorVerifiedProcedure
    .input(
      baseInput.extend({
        email: z.email(),
        role: z.enum(["member", "admin"]),
        permissions: permissionsSchema,
        customRoleId: z.string().min(1).optional(),
        emailChannelId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actor = await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "member:manage",
      );
      assertManager(actor.role);
      if (actor.role === "admin" && input.role !== "member")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admins can only invite members",
        });
      const assignment = await resolveRoleAssignment(
        db,
        input.organizationId,
        input.role,
        input.permissions,
        input.customRoleId,
        actor.role,
      );
      const channel = await db
        .select({
          id: notificationChannel.id,
          provider: notificationChannel.provider,
          organizationId: notificationChannel.organizationId,
        })
        .from(notificationChannel)
        .where(eq(notificationChannel.id, input.emailChannelId))
        .limit(1)
        .then((rows) => rows[0]);
      if (
        !channel ||
        channel.organizationId !== input.organizationId ||
        !["email", "resend"].includes(channel.provider)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Choose an Email or Resend notification channel from this workspace",
        });
      return auth.api.createInvitation({
        body: {
          email: input.email,
          role: input.role,
          organizationId: input.organizationId,
          permissions: JSON.stringify(assignment.permissions),
          emailChannelId: input.emailChannelId,
        },
        headers: ctx.honoContext.req.raw.headers,
      });
    }),

  update: twoFactorVerifiedProcedure
    .input(
      baseInput.extend({
        memberId: z.string().min(1),
        role: z.enum(["member", "admin"]),
        permissions: permissionsSchema,
        customRoleId: z.string().min(1).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actor = await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "member:manage",
      );
      const target = await db
        .select()
        .from(member)
        .where(
          and(
            eq(member.id, input.memberId),
            eq(member.organizationId, input.organizationId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]);
      if (!target)
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      assertManager(actor.role, target.role);
      if (actor.role === "admin" && input.role !== "member")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admins can only manage members",
        });
      const assignment = await resolveRoleAssignment(
        db,
        input.organizationId,
        input.role,
        input.permissions,
        input.customRoleId,
        actor.role,
      );
      await db
        .update(member)
        .set({
          role: assignment.role,
          permissions: JSON.stringify(assignment.permissions),
        })
        .where(eq(member.id, input.memberId));
      return { success: true };
    }),

  remove: twoFactorVerifiedProcedure
    .input(baseInput.extend({ memberId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const actor = await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "member:manage",
      );
      const target = await db
        .select()
        .from(member)
        .where(
          and(
            eq(member.id, input.memberId),
            eq(member.organizationId, input.organizationId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]);
      if (!target)
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      assertManager(actor.role, target.role);
      await db.delete(member).where(eq(member.id, input.memberId));
      return { success: true };
    }),
});
