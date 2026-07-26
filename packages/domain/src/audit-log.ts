import type { JsonObject } from "./json";

export const AUDIT_ACTIONS = [
  "read",
  "create",
  "update",
  "delete",
  "deploy",
  "cancel",
  "run",
  "start",
  "stop",
  "reload",
  "login",
  "logout",
  "failure",
  "invite",
  "revoke",
  "rotate",
  "test",
  "import",
  "restore",
  "duplicate",
  "configure",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_RESOURCE_TYPES = [
  "project",
  "environment",
  "resource",
  "deployment",
  "user",
  "organization",
  "server",
  "ssh_key",
  "git_provider",
  "registry",
  "backup",
  "notification",
  "settings",
  "docker",
  "swarm",
  "session",
  "custom_role",
  "tag",
  "template",
  "certificate",
  "schedule",
  "domain",
  "application",
  "database",
  "compose",
  "port",
  "mount",
  "system",
] as const;
export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

export type AuditLogRecord = {
  id: string;
  organizationId: string;
  actorId: string | null;
  actorName: string;
  actorEmail: string;
  actorRole: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string | null;
  resourceName: string | null;
  route: string;
  metadata: JsonObject;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
};

export type CreateAuditLog = Omit<AuditLogRecord, "id" | "createdAt">;

export type ListAuditLogsInput = {
  organizationId: string;
  actorId?: string;
  action?: AuditAction;
  resourceType?: AuditResourceType;
  search?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
};

export type ListAuditLogsResult = {
  items: AuditLogRecord[];
  total: number;
};

export interface IAuditLogRepository {
  create(input: CreateAuditLog): Promise<void>;
  list(input: ListAuditLogsInput): Promise<ListAuditLogsResult>;
}
