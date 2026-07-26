import { relations } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const scimProvider = pgTable(
  "scim_provider",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("scim_provider_organization_provider_uidx").on(
      table.organizationId,
      table.providerId,
    ),
    uniqueIndex("scim_provider_token_hash_uidx").on(table.tokenHash),
    index("scim_provider_organization_idx").on(table.organizationId),
  ],
);

export const scimProviderRelations = relations(scimProvider, ({ one }) => ({
  organization: one(organization, {
    fields: [scimProvider.organizationId],
    references: [organization.id],
  }),
}));
