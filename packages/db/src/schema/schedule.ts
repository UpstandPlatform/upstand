import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { backupSchedule } from "./backup";
import { resource } from "./resource";

export const schedule = pgTable(
  "schedule",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id").references(() => resource.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description"),
    cronExpression: text("cron_expression").notNull(),
    httpMethod: text("http_method"),
    secretEnvVar: text("secret_env_var"),
    timezone: text("timezone").notNull().default("UTC"),
    jobType: text("job_type").notNull().default("command"), // "command" | "deployment" | "backup" | "cron"
    serviceName: text("service_name"),
    shellType: text("shell_type").notNull().default("bash"), // "bash" | "sh"
    source: text("source").notNull().default("manual"), // "upstand.json" | "manual"
    backupScheduleId: text("backup_schedule_id").references(
      () => backupSchedule.id,
      { onDelete: "set null" },
    ),
    command: text("command").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at"),
    lastRunStatus: text("last_run_status"), // "success" | "failed"
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("schedule_resource_idx").on(table.resourceId),
    index("schedule_enabled_idx").on(table.enabled),
    index("schedule_backup_schedule_idx").on(table.backupScheduleId),
  ],
);

export const scheduleLog = pgTable(
  "schedule_log",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => schedule.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").references(() => resource.id, {
      onDelete: "cascade",
    }),
    status: text("status").notNull(), // "success" | "failed"
    statusCode: integer("status_code"),
    durationMs: integer("duration_ms").notNull(),
    responseBody: text("response_body"),
    errorMessage: text("error_message"),
    executedAt: timestamp("executed_at").defaultNow().notNull(),
  },
  (table) => [
    index("schedule_log_schedule_idx").on(table.scheduleId),
    index("schedule_log_resource_idx").on(table.resourceId),
    index("schedule_log_executed_idx").on(table.executedAt),
  ],
);

export const scheduleRelations = relations(schedule, ({ one, many }) => ({
  resource: one(resource, {
    fields: [schedule.resourceId],
    references: [resource.id],
  }),
  logs: many(scheduleLog),
}));

export const scheduleLogRelations = relations(scheduleLog, ({ one }) => ({
  schedule: one(schedule, {
    fields: [scheduleLog.scheduleId],
    references: [schedule.id],
  }),
  resource: one(resource, {
    fields: [scheduleLog.resourceId],
    references: [resource.id],
  }),
}));
