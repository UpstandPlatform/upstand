import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { db } from "@upstand/db";
import { invitation, member } from "@upstand/db/schema/auth";
import { customRole } from "@upstand/db/schema/custom-role";
import {
  capabilitiesForRole,
  MEMBER_SCOPE_ACTIONS,
  MemberPermissionsSchema,
  parseCapabilities,
} from "@upstand/domain";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { router, twoFactorVerifiedProcedure } from "../index";
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

async function assertManager(userId: string, organizationId: string) {
  const actor = await checkPermission(
    userId,
    organizationId,
    "custom_role:manage",
  );
  return actor;
}

function assertDelegablePermissions(
  actorRole: string,
  permissions: PermissionAction[],
): void {
  const allowed = new Set(
    actorRole === "owner"
      ? MEMBER_SCOPE_ACTIONS
      : capabilitiesForRole(actorRole),
  );
  if (permissions.some((permission) => !allowed.has(permission))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "A custom role cannot delegate permissions you do not hold",
    });
  }
}

function toView(row: typeof customRole.$inferSelect) {
  let value: unknown;
  try {
    value = JSON.parse(row.permissions);
  } catch {
    value = [];
  }
  const permissions = parseCapabilities(value).filter((permission) =>
    permissionActions.includes(permission),
  );
  return { ...row, permissions };
}

export const customRoleRouter = router({
  list: twoFactorVerifiedProcedure
    .input(baseInput)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "custom_role:view",
      );
      const rows = await db
        .select()
        .from(customRole)
        .where(eq(customRole.organizationId, input.organizationId));
      return rows.map(toView);
    }),

  create: twoFactorVerifiedProcedure
    .input(
      baseInput.extend({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500).optional(),
        permissions: permissionsSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actor = await assertManager(
        ctx.session.user.id,
        input.organizationId,
      );
      assertDelegablePermissions(actor.role, input.permissions);
      const [row] = await db
        .insert(customRole)
        .values({
          id: randomUUID(),
          organizationId: input.organizationId,
          name: input.name,
          description: input.description || null,
          permissions: JSON.stringify([...new Set(input.permissions)]),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return toView(row);
    }),

  update: twoFactorVerifiedProcedure
    .input(
      baseInput.extend({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(500).nullable().optional(),
        permissions: permissionsSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actor = await assertManager(
        ctx.session.user.id,
        input.organizationId,
      );
      if (input.permissions) {
        assertDelegablePermissions(actor.role, input.permissions);
      }
      const [row] = await db
        .update(customRole)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          ...(input.permissions === undefined
            ? {}
            : { permissions: JSON.stringify([...new Set(input.permissions)]) }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(customRole.id, input.id),
            eq(customRole.organizationId, input.organizationId),
          ),
        )
        .returning();
      if (!row)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom role not found",
        });
      return toView(row);
    }),

  remove: twoFactorVerifiedProcedure
    .input(baseInput.extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertManager(ctx.session.user.id, input.organizationId);
      await db.transaction(async (tx) => {
        await tx
          .update(member)
          .set({
            role: "member",
            permissions: JSON.stringify(ROLE_PERMISSIONS.member),
          })
          .where(
            and(
              eq(member.organizationId, input.organizationId),
              eq(member.role, `custom:${input.id}`),
            ),
          );

        await tx
          .update(invitation)
          .set({
            role: "member",
            permissions: JSON.stringify(ROLE_PERMISSIONS.member),
          })
          .where(
            and(
              eq(invitation.organizationId, input.organizationId),
              eq(invitation.role, `custom:${input.id}`),
            ),
          );

        const deleted = await tx
          .delete(customRole)
          .where(
            and(
              eq(customRole.id, input.id),
              eq(customRole.organizationId, input.organizationId),
            ),
          )
          .returning({ id: customRole.id });
        if (!deleted.length) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Custom role not found",
          });
        }
      });
      return { success: true };
    }),
});
