import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { resource } from "./resource";
import { s3Destination } from "./s3-destination";

export const backupSchedule = pgTable(
  "backup_schedule",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id").references(() => resource.id, {
      onDelete: "cascade",
    }),
    organizationId: text("organization_id").notNull(),
    destinationId: text("destination_id")
      .notNull()
      .references(() => s3Destination.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    cronExpression: text("cron_expression").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    prefix: text("prefix").notNull().default(""),
    retentionCount: integer("retention_count"),
    enabled: boolean("enabled").notNull().default(true),
    databaseName: text("database_name"),
    databaseEngine: text("database_engine"),
    serviceName: text("service_name"),
    volumeName: text("volume_name"),
    stopService: boolean("stop_service").notNull().default(false),
    encryptedConfiguration: text("encrypted_configuration"),
    pointInTimeRecovery: boolean("point_in_time_recovery")
      .notNull()
      .default(false),
    restoreVerification: boolean("restore_verification")
      .notNull()
      .default(true),
    replicaCount: integer("replica_count").notNull().default(0),
    failoverEnabled: boolean("failover_enabled").notNull().default(false),
    migrationCommand: text("migration_command"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("backup_schedule_resource_idx").on(table.resourceId),
    index("backup_schedule_enabled_idx").on(table.enabled),
    index("backup_schedule_organization_idx").on(table.organizationId),
    index("backup_schedule_destination_idx").on(table.destinationId),
  ],
);

export const backupRun = pgTable(
  "backup_run",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => backupSchedule.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").references(() => resource.id, {
      onDelete: "cascade",
    }),
    organizationId: text("organization_id").notNull(),
    destinationId: text("destination_id")
      .notNull()
      .references(() => s3Destination.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("queued"),
    fileKey: text("file_key"),
    error: text("error"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    verificationStatus: text("verification_status"),
    verifiedAt: timestamp("verified_at"),
    restoreTestedAt: timestamp("restore_tested_at"),
    recoveryPoint: text("recovery_point"),
  },
  (table) => [
    index("backup_run_schedule_created_idx").on(
      table.scheduleId,
      table.createdAt,
    ),
    index("backup_run_resource_created_idx").on(
      table.resourceId,
      table.createdAt,
    ),
    index("backup_run_status_idx").on(table.status),
    index("backup_run_organization_idx").on(table.organizationId),
    index("backup_run_destination_idx").on(table.destinationId),
  ],
);

export const backupScheduleRelations = relations(
  backupSchedule,
  ({ one, many }) => ({
    resource: one(resource, {
      fields: [backupSchedule.resourceId],
      references: [resource.id],
    }),
    destination: one(s3Destination, {
      fields: [backupSchedule.destinationId],
      references: [s3Destination.id],
    }),
    runs: many(backupRun),
  }),
);

export const backupRunRelations = relations(backupRun, ({ one }) => ({
  schedule: one(backupSchedule, {
    fields: [backupRun.scheduleId],
    references: [backupSchedule.id],
  }),
  resource: one(resource, {
    fields: [backupRun.resourceId],
    references: [resource.id],
  }),
  destination: one(s3Destination, {
    fields: [backupRun.destinationId],
    references: [s3Destination.id],
  }),
}));
