import { relations } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { sshKey } from "./ssh-key";

export const server = pgTable(
  "server",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    serverType: text("server_type").notNull(), // 'deploy' | 'database'
    authType: text("auth_type").notNull().default("ssh_key"), // 'ssh_key' | 'password'
    sshKeyId: text("ssh_key_id").references(() => sshKey.id, {
      onDelete: "set null",
    }),
    passwordCiphertext: text("password_ciphertext"),
    passwordIv: text("password_iv"),
    passwordAuthTag: text("password_auth_tag"),
    passwordVersion: integer("password_version"),
    sshHostKeyFingerprint: text("ssh_host_key_fingerprint"),
    ipAddress: text("ip_address").notNull(),
    port: integer("port").notNull().default(22),
    username: text("username").notNull().default("root"),
    enableDockerCleanup: boolean("enable_docker_cleanup")
      .notNull()
      .default(false),
    status: text("status").notNull().default("idle"), // 'idle' | 'setting_up' | 'ready' | 'failed'
    setupError: text("setup_error"),
    setupStage: text("setup_stage"),
    setupLogs: text("setup_logs"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("server_organization_id_uidx").on(
      table.organizationId,
      table.id,
    ),
    index("server_organization_idx").on(table.organizationId),
    index("server_ssh_key_idx").on(table.sshKeyId),
    foreignKey({
      columns: [table.organizationId, table.sshKeyId],
      foreignColumns: [sshKey.organizationId, sshKey.id],
      name: "server_organization_ssh_key_fk",
    }),
  ],
);

export const serverRelations = relations(server, ({ one }) => ({
  organization: one(organization, {
    fields: [server.organizationId],
    references: [organization.id],
  }),
  sshKey: one(sshKey, {
    fields: [server.sshKeyId],
    references: [sshKey.id],
  }),
}));
