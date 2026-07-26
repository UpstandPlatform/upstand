import { relations } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const sshKey = pgTable(
  "ssh_key",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    algorithm: text("algorithm", { enum: ["ed25519", "rsa"] }).notNull(),
    publicKey: text("public_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    privateKeyCiphertext: text("private_key_ciphertext").notNull(),
    privateKeyIv: text("private_key_iv").notNull(),
    privateKeyAuthTag: text("private_key_auth_tag").notNull(),
    privateKeyVersion: integer("private_key_version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdBy: text("created_by").notNull(),
  },
  (table) => [index("ssh_key_organization_idx").on(table.organizationId)],
);

export const sshKeyRelations = relations(sshKey, ({ one }) => ({
  organization: one(organization, {
    fields: [sshKey.organizationId],
    references: [organization.id],
  }),
}));
