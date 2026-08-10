import type { WorkloadMigration } from "@upstand/domain";
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { deployment } from "./deployment";
import { resource } from "./resource";

export const workloadMigration = pgTable(
  "workload_migration",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployment.id, { onDelete: "cascade" }),
    sourceServerId: text("source_server_id").notNull(),
    targetServerId: text("target_server_id").notNull(),
    status: text("status").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    executionToken: text("execution_token"),
    attempt: integer("attempt").notNull().default(0),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    cleanupConfirmed: boolean("cleanup_confirmed").notNull().default(false),
    sourceRetained: boolean("source_retained").notNull().default(true),
    checkpoint: jsonb("checkpoint")
      .$type<WorkloadMigration["checkpoint"]>()
      .notNull()
      .default({}),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    heartbeatAt: timestamp("heartbeat_at"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("workload_migration_active_resource_uidx")
      .on(table.resourceId)
      .where(sql`${table.status} NOT IN ('completed', 'failed', 'cancelled')`),
    index("workload_migration_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("workload_migration_resumable_idx").on(table.status, table.updatedAt),
    index("workload_migration_target_idx").on(
      table.targetServerId,
      table.status,
    ),
  ],
);

export const workloadMigrationRelations = relations(
  workloadMigration,
  ({ one }) => ({
    organization: one(organization, {
      fields: [workloadMigration.organizationId],
      references: [organization.id],
    }),
    resource: one(resource, {
      fields: [workloadMigration.resourceId],
      references: [resource.id],
    }),
    deployment: one(deployment, {
      fields: [workloadMigration.deploymentId],
      references: [deployment.id],
    }),
  }),
);
