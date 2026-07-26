import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { resource } from "./resource";

export const tag = pgTable(
  "tag",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#6366f1"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("tag_organization_name_uidx").on(
      table.organizationId,
      table.name,
    ),
    index("tag_organization_idx").on(table.organizationId),
    check("tag_color_hex_check", sql`${table.color} ~ '^#[0-9a-fA-F]{6}$'`),
  ],
);

export const resourceTag = pgTable(
  "resource_tag",
  {
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("resource_tag_uidx").on(table.resourceId, table.tagId),
    index("resource_tag_resource_idx").on(table.resourceId),
    index("resource_tag_tag_idx").on(table.tagId),
  ],
);

export const tagRelations = relations(tag, ({ one, many }) => ({
  organization: one(organization, {
    fields: [tag.organizationId],
    references: [organization.id],
  }),
  resources: many(resourceTag),
}));

export const resourceTagRelations = relations(resourceTag, ({ one }) => ({
  resource: one(resource, {
    fields: [resourceTag.resourceId],
    references: [resource.id],
  }),
  tag: one(tag, {
    fields: [resourceTag.tagId],
    references: [tag.id],
  }),
}));
