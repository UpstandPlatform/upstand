import { TRPCError } from "@trpc/server";
import { db } from "@upstand/db";
import { user } from "@upstand/db/schema/auth";
import {
  CAPABILITY_ACTIONS,
  CAPABILITY_CATALOG,
  type Capability,
  CUSTOM_ROLE_CAPABILITY_ACTIONS,
  capabilitiesForRole,
  hasApiKeyPermission,
  hasMcpPermission,
  MCP_TOOL_CAPABILITIES,
  type OrganizationRole,
  parseCapabilities,
} from "@upstand/domain";
import { env } from "@upstand/env/server";
import { asc, eq } from "drizzle-orm";
import { ensureOrganizationAccess } from "./access-control";
import type { ApiKeyPrincipal } from "./api-key-auth";
import type { AuthenticatedContext } from "./context";

/** Backwards-compatible name used by routers while the catalog stays domain-owned. */
export type PermissionAction = Capability;

/**
 * Role grants are generated from CAPABILITY_CATALOG. There is intentionally
 * no instance-wide role in this map: instance capabilities cannot be granted
 * by an ordinary organization membership.
 */
export const ROLE_PERMISSIONS: Record<OrganizationRole, PermissionAction[]> = {
  owner: [...capabilitiesForRole("owner")],
  admin: [...capabilitiesForRole("admin")],
  member: [...capabilitiesForRole("member")],
};

export const PERMISSION_ACTIONS = CAPABILITY_ACTIONS;

export type AuthorizationActor = {
  userId: string;
  organizationId: string;
};

export type AuthorizationPrincipal =
  | (AuthorizationActor & { kind: "session" })
  | (ApiKeyPrincipal & { kind: "api-key" });

export type AuthorizationRequest = {
  principal: AuthorizationPrincipal;
  organizationId: string;
  capability: PermissionAction;
};

export type InstanceAuthorizationActor = {
  userId: string;
  kind: string | undefined;
};

type OrganizationAccessResolver = typeof ensureOrganizationAccess;

/** The application policy decision point used by session-backed routes. */
export class AuthorizationService {
  constructor(
    private readonly resolveOrganizationAccess: OrganizationAccessResolver = ensureOrganizationAccess,
  ) {}

  async authorize(request: AuthorizationRequest) {
    const definition = CAPABILITY_CATALOG[request.capability];
    if (!definition) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Unknown capability.",
      });
    }
    if (request.organizationId !== request.principal.organizationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "The actor cannot access another organization.",
      });
    }

    if (request.principal.kind === "api-key") {
      if (
        !request.principal.userId ||
        request.principal.userId.startsWith("api-key:")
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This API key has no auditable organization user.",
        });
      }
      await this.resolveOrganizationAccess(
        request.principal.userId,
        request.organizationId,
      );
      if (!definition.apiKey) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `API keys cannot use capability '${request.capability}'.`,
        });
      }
      if (
        !hasApiKeyPermission(request.principal.permissions, request.capability)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `API key permission required: ${request.capability}`,
        });
      }
      return request.principal;
    }

    return this.authorizeSession(
      request.principal.userId,
      request.organizationId,
      request.capability,
    );
  }

  async authorizeSession(
    userId: string,
    organizationId: string,
    capability: PermissionAction,
  ) {
    const membership = await this.resolveOrganizationAccess(
      userId,
      organizationId,
    );
    const permissions = membership.permissions
      ? parseStoredPermissions(membership.permissions, membership.role)
      : ROLE_PERMISSIONS[membership.role as OrganizationRole] || [];

    if (!permissions.includes(capability)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Required permission not met. Action '${capability}' is not allowed for role '${membership.role}'`,
      });
    }

    return membership;
  }

  async authorizeMcpTool(
    principal: ApiKeyPrincipal,
    toolName: string,
  ): Promise<void> {
    const capability =
      MCP_TOOL_CAPABILITIES[toolName as keyof typeof MCP_TOOL_CAPABILITIES];
    if (!capability || !hasMcpPermission(principal.permissions, toolName)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "The MCP tool is not available for this API key.",
      });
    }

    if (
      toolName === "get_web_server_logs" ||
      toolName === "get_swarm_info" ||
      toolName === "get_swarm_nodes" ||
      toolName === "get_swarm_containers"
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "The requested MCP tool is restricted to instance owner sessions.",
      });
    }

    await this.authorize({
      principal,
      organizationId: principal.organizationId,
      capability,
    });
  }

  async isInstanceOwner(actor: InstanceAuthorizationActor): Promise<boolean> {
    if (actor.kind !== "session") {
      return false;
    }

    const configuredOwnerId = env.UPSTAND_INSTANCE_OWNER_USER_ID?.trim();
    if (configuredOwnerId) {
      return configuredOwnerId === actor.userId;
    }

    const configuredOwnerEmail =
      env.UPSTAND_INSTANCE_OWNER_EMAIL?.trim()?.toLowerCase();
    if (configuredOwnerEmail) {
      const currentUser = await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, actor.userId))
        .limit(1)
        .then((rows) => rows[0]);

      return Boolean(
        currentUser && currentUser.email.toLowerCase() === configuredOwnerEmail,
      );
    }

    const firstUser = await db
      .select({ id: user.id })
      .from(user)
      .orderBy(asc(user.createdAt), asc(user.id))
      .limit(1)
      .then((rows) => rows[0]);
    return Boolean(firstUser && firstUser.id === actor.userId);
  }

  async authorizeInstance(actor: InstanceAuthorizationActor): Promise<void> {
    if (actor.kind !== "session") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Instance operations require an interactive owner session",
      });
    }

    if (!(await this.isInstanceOwner(actor))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Instance owner permission required",
      });
    }
  }
}

function parseStoredPermissions(
  value: string,
  role: string,
): PermissionAction[] {
  try {
    const allowed = new Set<PermissionAction>(
      role.startsWith("custom:")
        ? CUSTOM_ROLE_CAPABILITY_ACTIONS
        : capabilitiesForRole(role),
    );
    return parseCapabilities(JSON.parse(value)).filter((permission) =>
      allowed.has(permission),
    );
  } catch {
    return [];
  }
}

export const authorizationService = new AuthorizationService();

/**
 * Checks if a user has a capability in an organization. All existing router
 * call sites now pass through the same policy decision point.
 */
export async function checkPermission(
  userId: string,
  organizationId: string,
  action: PermissionAction,
) {
  return authorizationService.authorizeSession(userId, organizationId, action);
}

export function authorizeApiKeyCapability(
  principal: ApiKeyPrincipal,
  organizationId: string,
  capability: PermissionAction,
): Promise<void> {
  return authorizationService
    .authorize({ principal, organizationId, capability })
    .then(() => undefined);
}

export function authorizeMcpTool(
  principal: ApiKeyPrincipal,
  toolName: string,
): Promise<void> {
  return authorizationService.authorizeMcpTool(principal, toolName);
}

export function isInstanceOwner(
  actor: InstanceAuthorizationActor,
): Promise<boolean> {
  return authorizationService.isInstanceOwner(actor);
}

export function authorizeContextCapability(
  ctx: AuthenticatedContext,
  organizationId: string,
  capability: PermissionAction,
): Promise<unknown> {
  const principal =
    ctx.actor.kind === "api-key"
      ? ctx.actor
      : {
          kind: "session" as const,
          userId: ctx.session.user.id,
          organizationId,
        };
  return authorizationService.authorize({
    principal,
    organizationId,
    capability,
  });
}
