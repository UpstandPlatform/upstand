import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const gitProvider = pgTable(
  "git_provider",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider").notNull(), // 'github' | 'gitlab' | 'bitbucket' | 'gitea'
    config: text("config").notNull(), // JSON string for credentials (e.g. client ID, client Secret, tokens, etc.)
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("git_provider_organization_idx").on(table.organizationId)],
);

export const gitProviderRelations = relations(gitProvider, ({ one }) => ({
  organization: one(organization, {
    fields: [gitProvider.organizationId],
    references: [organization.id],
  }),
}));
