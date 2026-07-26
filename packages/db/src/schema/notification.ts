import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const notificationChannel = pgTable(
  "notification_channel",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    events: text("events").array().notNull(),
    encryptedConfiguration: text("encrypted_configuration").notNull(),
    configurationSummary: jsonb("configuration_summary").$type<
      Record<string, unknown>
    >(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("notification_channel_organization_idx").on(table.organizationId),
    index("notification_channel_events_idx").using("gin", table.events),
  ],
);

export const notificationDelivery = pgTable(
  "notification_delivery",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => notificationChannel.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    idempotencyKey: text("idempotency_key"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    deliveredAt: timestamp("delivered_at"),
    processingStartedAt: timestamp("processing_started_at"),
    lastAttemptAt: timestamp("last_attempt_at"),
    nextAttemptAt: timestamp("next_attempt_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("notification_delivery_channel_idx").on(table.channelId),
    index("notification_delivery_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("notification_delivery_status_idx").on(table.status),
    uniqueIndex("notification_delivery_idempotency_uidx").on(
      table.idempotencyKey,
    ),
  ],
);

export const notificationChannelRelations = relations(
  notificationChannel,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [notificationChannel.organizationId],
      references: [organization.id],
    }),
    deliveries: many(notificationDelivery),
  }),
);

export const notificationDeliveryRelations = relations(
  notificationDelivery,
  ({ one }) => ({
    organization: one(organization, {
      fields: [notificationDelivery.organizationId],
      references: [organization.id],
    }),
    channel: one(notificationChannel, {
      fields: [notificationDelivery.channelId],
      references: [notificationChannel.id],
    }),
  }),
);
