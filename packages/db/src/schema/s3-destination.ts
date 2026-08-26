import { relations } from "drizzle-orm";
import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { certificate } from "./certificate";

export const s3Destination = pgTable(
  "s3_destination",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider").notNull(), // e.g. "AWS", "Cloudflare", "Wasabi", etc.
    accessKeyId: text("access_key_id").notNull(),
    secretAccessKey: text("secret_access_key").notNull(),
    bucket: text("bucket").notNull(),
    region: text("region").notNull(),
    endpoint: text("endpoint").notNull(),
    certificateId: text("certificate_id").references(() => certificate.id, {
      onDelete: "set null",
    }),
    additionalFlags: text("additional_flags").default("[]").notNull(), // JSON array of flags as string
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("s3_destination_organization_idx").on(table.organizationId),
    unique("s3_destination_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    foreignKey({
      columns: [table.organizationId, table.certificateId],
      foreignColumns: [certificate.organizationId, certificate.id],
      name: "s3_destination_organization_certificate_fk",
    }),
  ],
);

export const s3DestinationRelations = relations(s3Destination, ({ one }) => ({
  organization: one(organization, {
    fields: [s3Destination.organizationId],
    references: [organization.id],
  }),
  certificate: one(certificate, {
    fields: [s3Destination.certificateId],
    references: [certificate.id],
  }),
}));
