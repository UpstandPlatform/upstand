import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const certificate = pgTable(
  "certificate",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    certificatePem: text("certificate_pem").notNull(),
    privateKeyPem: text("private_key_pem").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("certificate_organization_idx").on(table.organizationId)],
);

export const certificateRelations = relations(certificate, ({ one }) => ({
  organization: one(organization, {
    fields: [certificate.organizationId],
    references: [organization.id],
  }),
}));
