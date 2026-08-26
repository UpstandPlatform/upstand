import type {
  ControlPlaneTransferManifest,
  PortableControlPlaneRecord,
} from "@upstand/domain";
import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const controlPlaneIdentity = pgTable("control_plane_identity", {
  id: text("id").primaryKey().default("global"),
  instanceId: text("instance_id").notNull().unique(),
  ownerUserId: text("owner_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const controlPlaneTransferSession = pgTable(
  "control_plane_transfer_session",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull().default("staging"),
    manifest: jsonb("manifest").$type<ControlPlaneTransferManifest>().notNull(),
    stagedSecrets:
      jsonb("staged_secrets").$type<
        Record<string, Record<string, string | number>>
      >(),
    cursor: integer("cursor").notNull().default(0),
    importedCount: integer("imported_count").notNull().default(0),
    conflicts: jsonb("conflicts").$type<string[]>().notNull().default([]),
    lastError: text("last_error"),
    expiresAt: timestamp("expires_at").notNull(),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("control_plane_transfer_status_idx").on(
      table.status,
      table.expiresAt,
    ),
    index("control_plane_transfer_actor_idx").on(
      table.actorId,
      table.createdAt,
    ),
  ],
);

export const controlPlaneTransferRecord = pgTable(
  "control_plane_transfer_record",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => controlPlaneTransferSession.id, {
        onDelete: "cascade",
      }),
    sequence: integer("sequence").notNull(),
    tableName: text("table_name").notNull(),
    recordId: text("record_id").notNull(),
    checksum: text("checksum").notNull(),
    data: jsonb("data").$type<PortableControlPlaneRecord["data"]>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.sequence] }),
    uniqueIndex("control_plane_transfer_record_identity_uidx").on(
      table.sessionId,
      table.tableName,
      table.recordId,
    ),
    index("control_plane_transfer_record_table_idx").on(
      table.sessionId,
      table.tableName,
      table.sequence,
    ),
  ],
);

export const controlPlaneTransferSessionRelations = relations(
  controlPlaneTransferSession,
  ({ many }) => ({
    records: many(controlPlaneTransferRecord),
  }),
);

export const controlPlaneTransferRecordRelations = relations(
  controlPlaneTransferRecord,
  ({ one }) => ({
    session: one(controlPlaneTransferSession, {
      fields: [controlPlaneTransferRecord.sessionId],
      references: [controlPlaneTransferSession.id],
    }),
  }),
);
