import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const outbox = pgTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    aggregateType: text("aggregate_type"),
    aggregateId: text("aggregate_id"),
    organizationId: text("organization_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(10),
    availableAt: timestamp("available_at").defaultNow().notNull(),
    claimedAt: timestamp("claimed_at"),
    publishedAt: timestamp("published_at"),
    deadLetteredAt: timestamp("dead_lettered_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("outbox_idempotency_uidx").on(table.idempotencyKey),
    index("outbox_publication_idx").on(
      table.status,
      table.availableAt,
      table.createdAt,
    ),
    index("outbox_aggregate_idx").on(table.aggregateType, table.aggregateId),
    index("outbox_organization_idx").on(table.organizationId, table.createdAt),
  ],
);
