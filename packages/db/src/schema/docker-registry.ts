import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const dockerRegistry = pgTable(
  "docker_registry",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    username: text("username"),
    password: text("password"),
    imagePrefix: text("image_prefix"),
    registryUrl: text("registry_url"),
    serverId: text("server_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("docker_registry_organization_idx").on(table.organizationId),
    index("docker_registry_server_idx").on(table.serverId),
  ],
);

export const dockerRegistryRelations = relations(dockerRegistry, ({ one }) => ({
  organization: one(organization, {
    fields: [dockerRegistry.organizationId],
    references: [organization.id],
  }),
}));
