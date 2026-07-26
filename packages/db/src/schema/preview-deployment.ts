import { relations } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { resource } from "./resource";

export const previewDeployment = pgTable(
  "preview_deployment",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
    pullRequestId: integer("pull_request_id").notNull(),
    branchName: text("branch_name").notNull(),
    appName: text("app_name").notNull().unique(),
    status: text("status").notNull().default("idle"), // 'idle' | 'running' | 'success' | 'failed'
    domain: text("domain").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("preview_deployment_resource_idx").on(table.resourceId),
    index("preview_deployment_status_idx").on(table.status),
  ],
);

export const previewDeploymentRelations = relations(
  previewDeployment,
  ({ one }) => ({
    resource: one(resource, {
      fields: [previewDeployment.resourceId],
      references: [resource.id],
    }),
  }),
);
