import { relations } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const customRole = pgTable(
  "custom_role",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    permissions: text("permissions").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("custom_role_organization_name_idx").on(
      table.organizationId,
      table.name,
    ),
    index("custom_role_organization_idx").on(table.organizationId),
  ],
);

export const customRoleRelations = relations(customRole, ({ one }) => ({
  organization: one(organization, {
    fields: [customRole.organizationId],
    references: [organization.id],
  }),
}));
