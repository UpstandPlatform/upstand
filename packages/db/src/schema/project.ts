import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const project = pgTable(
  "project",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    icon: text("icon"),
    description: text("description"),
    isApp: boolean("is_app").default(false).notNull(),
    appCatalogId: text("app_catalog_id"),
    appVersion: text("app_version"),
    appVerified: boolean("app_verified"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("project_organization_idx").on(table.organizationId),
    index("project_app_catalog_idx").on(table.appCatalogId),
  ],
);

export const projectRelations = relations(project, ({ one }) => ({
  organization: one(organization, {
    fields: [project.organizationId],
    references: [organization.id],
  }),
}));
