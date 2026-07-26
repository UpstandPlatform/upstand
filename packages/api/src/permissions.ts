import { TRPCError } from "@trpc/server";
import { db } from "@upstand/db";
import { user } from "@upstand/db/schema/auth";
import {
  CAPABILITY_ACTIONS,
  CAPABILITY_CATALOG,
  type Capability,
  capabilitiesForRole,
  hasApiKeyPermission,
  hasMcpPermission,
  MCP_TOOL_CAPABILITIES,
  type OrganizationRole,
  parseCapabilities,
} from "@upstand/domain";
import { env } from "@upstand/env/server";
import { asc } from "drizzle-orm";
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

/** The application policy decision point used by session-backed routes. */
export class AuthorizationService {
  async authorize(request: AuthorizationRequest) {
    const definition = CAPABILITY_CATALOG[request.capability];
    if (request.organizationId !== request.principal.organizationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "The actor cannot access another organization.",
      });
    }

    if (request.principal.kind === "api-key") {
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
    const membership = await ensureOrganizationAccess(userId, organizationId);
    const permissions = membership.permissions
      ? parseStoredPermissions(membership.permissions)
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

    await this.authorize({
      principal,
      organizationId: principal.organizationId,
      capability,
    });
  }

  async authorizeInstance(actor: InstanceAuthorizationActor): Promise<void> {
    if (actor.kind !== "session") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Instance operations require an interactive owner session",
      });
    }

    const configuredOwner = env.UPSTAND_INSTANCE_OWNER_USER_ID?.trim();
    if (configuredOwner) {
      if (configuredOwner !== actor.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Instance owner permission required",
        });
      }
      return;
    }

    const firstUser = await db
      .select({ id: user.id })
      .from(user)
      .orderBy(asc(user.createdAt), asc(user.id))
      .limit(1)
      .then((rows) => rows[0]);
    if (!firstUser || firstUser.id !== actor.userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Instance owner permission required",
      });
    }
  }
}

function parseStoredPermissions(value: string): PermissionAction[] {
  try {
    return parseCapabilities(JSON.parse(value));
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
