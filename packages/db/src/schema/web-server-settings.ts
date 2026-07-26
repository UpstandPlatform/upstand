import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const webServerSettings = pgTable("web_server_settings", {
  id: text("id").primaryKey(), // always 'global'
  serverDomain: text("server_domain"),
  httpsEnabled: boolean("https_enabled").default(true).notNull(),
  certificateProvider: text("certificate_provider")
    .default("letsencrypt")
    .notNull(),
  certificateId: text("certificate_id"),
  letsEncryptEmail: text("lets_encrypt_email"),
  cloudflareApiToken: text("cloudflare_api_token"),
  httpPort: integer("http_port").default(80).notNull(),
  httpsPort: integer("https_port").default(443).notNull(),
  enableHttp3: boolean("enable_http3").default(true).notNull(),
  globalCaddyfile: text("global_caddyfile"),
  caddySnippets: text("caddy_snippets").default("").notNull(),
  caddyMiddlewares: text("caddy_middlewares").default("[]").notNull(),
  serverIp: text("server_ip"),
  dailyDockerCleanup: boolean("daily_docker_cleanup").default(false).notNull(),
  caddyEnvironment: text("caddy_environment").default("{}").notNull(),
  caddyPorts: text("caddy_ports").default("[]").notNull(),
  caddyDashboardEnabled: boolean("caddy_dashboard_enabled")
    .default(false)
    .notNull(),
  accessLogsEnabled: boolean("access_logs_enabled").default(false).notNull(),
  ipAccessEnabled: boolean("ip_access_enabled").default(true).notNull(),
  accessLogCleanupCron: text("access_log_cleanup_cron")
    .default("0 3 * * *")
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
