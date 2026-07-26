import { relations } from "drizzle-orm";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { server } from "./server";

export const monitoringSettings = pgTable("monitoring_settings", {
  // Primary key only — no FK to server.id so the local manager ("local")
  // can store its settings without requiring a row in the server table.
  serverId: text("server_id").primaryKey(),
  token: text("token").notNull(),
  cpuThreshold: integer("cpu_threshold").notNull().default(90),
  memoryThreshold: integer("memory_threshold").notNull().default(90),
  alertEmail: text("alert_email"),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const monitoringSettingsRelations = relations(
  monitoringSettings,
  ({ one }) => ({
    server: one(server, {
      fields: [monitoringSettings.serverId],
      references: [server.id],
    }),
  }),
);
