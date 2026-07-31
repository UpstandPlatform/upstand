import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { dockerRegistry } from "./docker-registry";
import { environment } from "./environment";
import { server } from "./server";

export const resource = pgTable(
  "resource",
  {
    id: text("id").primaryKey(),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(), // 'application' | 'database' | 'compose'
    status: text("status").default("idle").notNull(),
    provider: text("provider").notNull(), // e.g. "github", "gitlab", "bitbucket", "gitea", "git", "raw"
    appName: text("app_name"),
    description: text("description"),
    dbType: text("db_type"),
    composeType: text("compose_type"),
    dockerImage: text("docker_image"),
    buildRegistryId: text("build_registry_id").references(
      () => dockerRegistry.id,
      { onDelete: "set null" },
    ),
    rollbackActive: boolean("rollback_active").default(false).notNull(),
    rollbackRegistryId: text("rollback_registry_id").references(
      () => dockerRegistry.id,
      { onDelete: "set null" },
    ),
    externalPort: integer("external_port"),
    libsqlGrpcPort: integer("libsql_grpc_port"),
    libsqlAdminPort: integer("libsql_admin_port"),
    triggerType: text("trigger_type").default("push").notNull(),
    tagPattern: text("tag_pattern"),
    webhookTokenHash: text("webhook_token_hash").unique(),
    webhookTokenPrefix: text("webhook_token_prefix"),
    serverId: text("server_id").references(() => server.id, {
      onDelete: "set null",
    }),
    buildServerId: text("build_server_id").references(() => server.id, {
      onDelete: "set null",
    }),
    isPreviewDeploymentsActive: boolean("is_preview_deployments_active")
      .default(false)
      .notNull(),
    previewLimit: integer("preview_limit").default(3).notNull(),
    previewWildcard: text("preview_wildcard"),
    previewHttps: boolean("preview_https").default(false).notNull(),
    previewPort: integer("preview_port").default(3000).notNull(),
    cronJobsEnabled: boolean("cron_jobs_enabled").default(true).notNull(),
    icon: text("icon"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("resource_environment_idx").on(table.environmentId),
    index("resource_server_idx").on(table.serverId),
    index("resource_build_server_idx").on(table.buildServerId),
    index("resource_build_registry_idx").on(table.buildRegistryId),
    index("resource_rollback_registry_idx").on(table.rollbackRegistryId),
    index("resource_app_name_idx").on(table.appName),
  ],
);

export const resourceConfiguration = pgTable("resource_configuration", {
  resourceId: text("resource_id")
    .primaryKey()
    .references(() => resource.id, { onDelete: "cascade" }),
  version: integer("version").default(1).notNull(),
  buildConfig: text("build_config").notNull(),
  advancedConfig: text("advanced_config").notNull(),
  watchPaths: text("watch_paths").notNull(),
  domains: text("domains").notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const resourceSecret = pgTable("resource_secret", {
  resourceId: text("resource_id")
    .primaryKey()
    .references(() => resource.id, { onDelete: "cascade" }),
  version: integer("version").default(1).notNull(),
  credentials: text("credentials"),
  buildSecrets: text("build_secrets"),
  buildEnvVars: text("build_env_vars"),
  envVars: text("env_vars").notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const resourceRuntime = pgTable("resource_runtime", {
  resourceId: text("resource_id")
    .primaryKey()
    .references(() => resource.id, { onDelete: "cascade" }),
  version: integer("version").default(1).notNull(),
  containers: text("containers").notNull(),
  observedAt: timestamp("observed_at"),
  source: text("source").default("docker").notNull(),
});

export const resourceRelations = relations(resource, ({ one }) => ({
  environment: one(environment, {
    fields: [resource.environmentId],
    references: [environment.id],
  }),
  buildServer: one(server, {
    fields: [resource.buildServerId],
    references: [server.id],
  }),
  rollbackRegistry: one(dockerRegistry, {
    fields: [resource.rollbackRegistryId],
    references: [dockerRegistry.id],
  }),
  buildRegistry: one(dockerRegistry, {
    fields: [resource.buildRegistryId],
    references: [dockerRegistry.id],
  }),
  configuration: one(resourceConfiguration, {
    fields: [resource.id],
    references: [resourceConfiguration.resourceId],
  }),
  secrets: one(resourceSecret, {
    fields: [resource.id],
    references: [resourceSecret.resourceId],
  }),
  runtime: one(resourceRuntime, {
    fields: [resource.id],
    references: [resourceRuntime.resourceId],
  }),
}));
