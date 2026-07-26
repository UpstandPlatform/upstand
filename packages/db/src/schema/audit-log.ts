import type {
  AuditAction,
  AuditResourceType,
  JsonObject,
} from "@upstand/domain";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    actorEmail: text("actor_email").notNull(),
    actorRole: text("actor_role").notNull(),
    action: text("action").$type<AuditAction>().notNull(),
    resourceType: text("resource_type").$type<AuditResourceType>().notNull(),
    resourceId: text("resource_id"),
    resourceName: text("resource_name"),
    route: text("route").notNull(),
    metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("audit_log_org_action_idx").on(table.organizationId, table.action),
    index("audit_log_org_resource_idx").on(
      table.organizationId,
      table.resourceType,
    ),
    index("audit_log_actor_idx").on(table.actorId),
  ],
);
