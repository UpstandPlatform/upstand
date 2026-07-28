import {
  type AUDIT_ACTIONS,
  AUDIT_RESOURCE_TYPES,
  type JsonObject,
} from "@upstand/domain";
import {
  CreateAuditLogUseCaseToken,
  UnitOfWorkToken,
} from "@upstand/usecases/tokens";
import { ensureOrganizationAccess } from "../access-control";
import type { Context } from "../context";

export type AuditOutcome = {
  success: boolean;
  errorCode?: string;
};

export async function recordAuditEvent(
  ctx: Context,
  path: string,
  organizationId: string,
  input: unknown,
  outcome: AuditOutcome = { success: true },
) {
  try {
    if (!ctx.session || !ctx.actor) return;
    const membership = await ensureOrganizationAccess(
      ctx.session.user.id,
      organizationId,
    );
    const [resource = "system", operation = "read"] = path.split(".");
    const attemptedAction = resolveAuditAction(operation);
    const action = outcome.success ? attemptedAction : "failure";
    const resourceType = resolveAuditResourceType(resource);
    const inputMetadata = sanitizeAuditInput(input);
    const metadata = {
      ...inputMetadata,
      audit: {
        outcome: outcome.success ? "success" : "failure",
        attemptedAction,
        ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
      },
    } satisfies JsonObject;
    const resourceId = readStringField(inputMetadata, [
      "resourceId",
      "deploymentId",
      "projectId",
      "environmentId",
      "serverId",
      "providerId",
      "id",
    ]);
    const resourceName = readStringField(inputMetadata, [
      "resourceName",
      "serverName",
      "projectName",
      "environmentName",
      "name",
      "appName",
    ]);
    await ctx.scope.resolve(CreateAuditLogUseCaseToken).execute({
      organizationId,
      actorId: ctx.actor.userId,
      actorName: ctx.session.user.name,
      actorEmail: ctx.session.user.email,
      actorRole: membership.role,
      action,
      resourceType,
      resourceId,
      resourceName,
      route: path,
      metadata,
      ipAddress: ctx.honoContext.req.header("x-forwarded-for") ?? null,
      userAgent: ctx.honoContext.req.header("user-agent") ?? null,
    });
  } catch (error) {
    ctx.honoContext
      .get("log")
      .error(error instanceof Error ? error : String(error), {
        message: "Failed to persist audit event",
        route: path,
        organizationId,
      });
  }
}

export async function resolveAuditOrganizationId(
  ctx: Context,
  path: string,
  input: unknown,
): Promise<string | undefined> {
  if (input && typeof input === "object" && "organizationId" in input) {
    const value = input.organizationId;
    if (typeof value === "string" && value) return value;
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    return undefined;

  const values = input as Record<string, unknown>;
  const activeOrganizationId = (
    ctx.session?.session as { activeOrganizationId?: unknown } | undefined
  )?.activeOrganizationId;
  if (typeof activeOrganizationId === "string" && path !== "auditLog.list") {
    return activeOrganizationId;
  }

  const id = ["resourceId", "environmentId", "projectId", "serverId", "id"]
    .map((key) => values[key])
    .find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  if (!id) return undefined;

  const uow = ctx.scope.resolve(UnitOfWorkToken);
  const resource = path.split(".")[0];
  if (resource === "project")
    return (await uow.projectRepository.findById(id))?.organizationId;
  if (resource === "environment") {
    const environment = await uow.environmentRepository.findById(id);
    return environment
      ? (await uow.projectRepository.findById(environment.projectId))
          ?.organizationId
      : undefined;
  }
  if (resource === "resource") {
    const service = await uow.resourceRepository.findById(id);
    if (!service) return undefined;
    const environment = await uow.environmentRepository.findById(
      service.environmentId,
    );
    return environment
      ? (await uow.projectRepository.findById(environment.projectId))
          ?.organizationId
      : undefined;
  }
  if (resource === "deployment") {
    const deployment = await uow.deploymentRepository.findById(id);
    if (!deployment) return undefined;
    const service = await uow.resourceRepository.findById(
      deployment.resourceId,
    );
    if (!service) return undefined;
    const environment = await uow.environmentRepository.findById(
      service.environmentId,
    );
    return environment
      ? (await uow.projectRepository.findById(environment.projectId))
          ?.organizationId
      : undefined;
  }
  if (resource === "server")
    return (await uow.serverRepository.findById(id))?.organizationId;
  if (resource === "notification") {
    return (
      (await uow.notificationChannelRepository.findById(id))?.organizationId ??
      (await uow.notificationDeliveryRepository.findById(id))?.organizationId
    );
  }
  if (resource === "tag")
    return (await uow.tagRepository.findById(id))?.organizationId;
  if (resource === "template")
    return (await uow.templateRepository.findById(id))?.organizationId;
  if (resource === "certificate")
    return (await uow.certificateRepository.findById(id))?.organizationId;
  if (resource === "gitProvider")
    return (await uow.gitProviderRepository.findById(id))?.organizationId;
  if (resource === "dockerRegistry")
    return (await uow.dockerRegistryRepository.findById(id))?.organizationId;
  if (resource === "s3Destination")
    return (await uow.s3DestinationRepository.findById(id))?.organizationId;
  if (resource === "sshKey")
    return (await uow.sshKeyRepository.findById(id))?.organizationId;
  if (resource === "schedule") {
    const schedule = await uow.scheduleRepository.findById(id);
    if (!schedule?.resourceId) return undefined;
    const service = await uow.resourceRepository.findById(schedule.resourceId);
    if (!service) return undefined;
    const environment = await uow.environmentRepository.findById(
      service.environmentId,
    );
    return environment
      ? (await uow.projectRepository.findById(environment.projectId))
          ?.organizationId
      : undefined;
  }
  return undefined;
}

export function resolveAuditAction(
  operation: string,
): (typeof AUDIT_ACTIONS)[number] {
  const normalized = operation.toLowerCase();
  if (normalized.includes("invite")) return "invite";
  if (normalized.includes("revoke") || normalized.includes("remove"))
    return "revoke";
  if (normalized.includes("rotate")) return "rotate";
  if (normalized.includes("test")) return "test";
  if (normalized.includes("import")) return "import";
  if (normalized.includes("restore")) return "restore";
  if (normalized.includes("retry")) return "run";
  if (normalized.includes("duplicate")) return "duplicate";
  if (normalized.includes("delete")) return "delete";
  if (normalized.includes("create")) return "create";
  if (normalized.includes("update")) return "update";
  if (normalized.includes("deploy")) return "deploy";
  if (normalized.includes("cancel")) return "cancel";
  if (normalized.includes("start")) return "start";
  if (normalized.includes("stop")) return "stop";
  if (normalized.includes("reload")) return "reload";
  if (normalized.includes("run")) return "run";
  if (normalized.includes("config") || normalized.includes("save"))
    return "configure";
  return "read";
}

export function resolveAuditResourceType(
  resource: string,
): (typeof AUDIT_RESOURCE_TYPES)[number] {
  const aliases: Record<string, (typeof AUDIT_RESOURCE_TYPES)[number]> = {
    ai: "settings",
    apiKey: "settings",
    application: "application",
    compose: "compose",
    customRole: "custom_role",
    database: "database",
    domain: "domain",
    dockerRegistry: "registry",
    gitProvider: "git_provider",
    mount: "mount",
    port: "port",
    s3Destination: "backup",
    sshKey: "ssh_key",
    tag: "tag",
    template: "template",
    webServer: "settings",
  };
  return (
    aliases[resource] ??
    ((AUDIT_RESOURCE_TYPES as readonly string[]).includes(resource)
      ? (resource as (typeof AUDIT_RESOURCE_TYPES)[number])
      : "system")
  );
}

export function sanitizeAuditInput(input: unknown): JsonObject {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return sanitizeAuditObject(input, 0);
}

function sanitizeAuditObject(input: object, depth: number): JsonObject {
  const sensitive =
    /key|token|password|secret|credential|cookie|authorization|private/i;
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = key.toLowerCase();
    if (
      sensitive.test(key) ||
      normalizedKey === "env" ||
      normalizedKey === "environment"
    )
      continue;
    const sanitized = sanitizeAuditValue(value, depth);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return result;
}

function sanitizeAuditValue(value: unknown, depth: number) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") return value.slice(0, 500);
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") {
    return depth < 2
      ? sanitizeAuditObject(value, depth + 1)
      : "[nested object]";
  }
  return undefined;
}

function readStringField(
  input: JsonObject,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}
