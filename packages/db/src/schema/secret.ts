import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const secretVersion = pgTable(
  "secret_version",
  {
    id: text("id").primaryKey(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    version: integer("version").notNull(),
    credentials: text("credentials"),
    buildSecrets: text("build_secrets"),
    buildEnvVars: text("build_env_vars"),
    envVars: text("env_vars").notNull(),
    source: text("source").notNull().default("local"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("secret_version_scope_version_uidx").on(
      table.scopeType,
      table.scopeId,
      table.version,
    ),
    index("secret_version_scope_idx").on(
      table.scopeType,
      table.scopeId,
      table.createdAt,
    ),
  ],
);

export const secretProvider = pgTable(
  "secret_provider",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    encryptedConfiguration: text("encrypted_configuration").notNull(),
    enabled: text("enabled").notNull().default("true"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("secret_provider_organization_idx").on(table.organizationId),
  ],
);

export const secretRotationSchedule = pgTable(
  "secret_rotation_schedule",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    keys: text("keys").notNull(),
    intervalHours: integer("interval_hours").notNull(),
    valueLength: integer("value_length").notNull().default(32),
    enabled: boolean("enabled").notNull().default(true),
    lastRotatedAt: timestamp("last_rotated_at"),
    rotationClaimedUntil: timestamp("rotation_claimed_until"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("secret_rotation_schedule_org_idx").on(table.organizationId),
    index("secret_rotation_schedule_due_idx").on(
      table.enabled,
      table.lastRotatedAt,
    ),
    index("secret_rotation_schedule_scope_idx").on(
      table.scopeType,
      table.scopeId,
    ),
  ],
);
