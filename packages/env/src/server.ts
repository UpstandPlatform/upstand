import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv } from "@t3-oss/env-core";
import dotenv from "dotenv";
import { z } from "zod";
import { assertSecureProductionOrigins } from "./production-safety";

const currentDir =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(currentDir, "../../..");

dotenv.config();
dotenv.config({ path: path.join(monorepoRoot, "apps", "server", ".env") });
dotenv.config({ path: path.join(monorepoRoot, ".env") });

const isTest = process.env.NODE_ENV === "test";
const skipValidation =
  process.env.NEXT_PHASE === "phase-production-build" ||
  ["1", "true"].includes(
    process.env.SKIP_ENV_VALIDATION?.trim().toLowerCase() ?? "",
  );

const validatedEnv = createEnv({
  server: {
    DATABASE_URL:
      isTest || process.env.UPSTAND_PLATFORM === "desktop"
        ? z.string().optional()
        : z.string().min(1),
    UPSTAND_DATABASE_POOL_MAX: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20),
    UPSTAND_DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(10 * 60_000)
      .default(30_000),
    UPSTAND_DATABASE_POOL_CONNECTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(120_000)
      .default(5_000),
    BETTER_AUTH_SECRET: isTest ? z.string().optional() : z.string().min(32),
    BETTER_AUTH_URL: isTest ? z.string().optional() : z.url(),
    CORS_ORIGIN: isTest ? z.string().optional() : z.url(),
    TRUSTED_PROXY_CIDRS: z.string().default(""),
    TRUSTED_PROXY_HEADERS: z
      .preprocess(
        (value) => value === "true" || value === "1" || value === true,
        z.boolean(),
      )
      .default(false),
    UPSTAND_ALLOW_INSECURE_BOOTSTRAP: z
      .preprocess(
        (value) => value === "true" || value === "1" || value === true,
        z.boolean(),
      )
      .default(false),
    UPSTAND_ACCEPTANCE_ALLOW_UNENCRYPTED_NETWORK: z
      .preprocess(
        (value) => value === "true" || value === "1" || value === true,
        z.boolean(),
      )
      .default(false),
    AUTH_COOKIE_DOMAIN: z.string().trim().min(1).optional(),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    IS_CLOUD: z
      .preprocess(
        (val) => val === "true" || val === "1" || val === true,
        z.boolean(),
      )
      .default(false),
    UPSTAND_PLATFORM: z.enum(["desktop", "self-hosted", "cloud"]).optional(),
    PGLITE_DATA_DIR: z.string().min(1).optional(),
    PGLITE_ASSETS_DIR: z.string().min(1).optional(),
    SWAGGER_UI_ASSETS_DIR: z.string().min(1).optional(),
    UPSTAND_NODE_RUNTIME_PATH: z.string().min(1).optional(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    UPSTAND_AUTO_UPDATE: z
      .preprocess(
        (val) => val === "true" || val === "1" || val === true,
        z.boolean(),
      )
      .default(false),
    UPSTAND_SERVER_IMAGE: z.string().min(1).optional(),
    UPSTAND_UPDATE_COMPLETION_VERSION: z.string().min(1).optional(),
    UPSTAND_SCHEDULES_INTERNAL_URL: z.url().optional(),
    SERVER_ID: z.string().min(1).optional(),
    UPSTAND_CONTROL_PLANE_SSH_HOST_KEY_FINGERPRINT: z
      .string()
      .min(1)
      .optional(),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().trim().min(1).default("0.0.0.0"),
    HOST_IP: z.string().trim().min(1).optional(),
    SCHEDULES_PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
    UPSTAND_DOCKER_GID: z.coerce.number().int().min(0).optional(),
    OTLP_ENDPOINT: z.url().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    UPSTAND_MONITORING_IMAGE: z.string().min(1).optional(),
    DB_MIGRATIONS_PATH: z.string().min(1).optional(),
    UPGAL_MCP_SERVERS: z.string().optional(),
    UPGAL_ALLOW_GLOBAL_MCP: z
      .preprocess(
        (val) => val === "true" || val === "1" || val === true,
        z.boolean(),
      )
      .default(false),
    UPGAL_DAILY_RUN_LIMIT: z.coerce.number().int().positive().default(100),
    UPGAL_MAX_STEPS: z.coerce.number().int().min(1).max(12).default(8),
    UPGAL_ALLOW_CUSTOM_BASE_URL: z
      .preprocess(
        (val) => val === "true" || val === "1" || val === true,
        z.boolean(),
      )
      .default(false),
    UPSTAND_SKIP_MIGRATIONS: z
      .preprocess(
        (val) => val === "true" || val === "1" || val === true,
        z.boolean(),
      )
      .default(false),
    UPSTAND_MIGRATION_ID: z.string().min(1).optional(),
    UPGAL_WEB_SEARCH_API_KEY: z.string().optional(),
    UPGAL_WEB_SEARCH_BASE_URL: z
      .url()
      .default("https://api.search.brave.com/res/v1/web/search"),
    UPSTAND_INSTANCE_OWNER_USER_ID: z.string().min(1).optional(),
    UPSTAND_INSTANCE_OWNER_EMAIL: z.string().min(1).optional(),
    DOCKER_NETWORK: z.string().min(1).default("upstand-network"),
    REDIS_HOST: z.string().optional(),
    REDIS_PORT: z.coerce.number().optional(),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_URL: z.string().min(1).optional(),
    REDIS_URL_FILE: z.string().min(1).optional(),
    UPSTAND_BASE_URL: z.url().optional(),
    APP_URL: z.url().optional(),
    UPSTAND_POSTGRES_CONTAINER: z.string().min(1).optional(),
    ENCRYPTION_KEY_V1: isTest
      ? z.string().optional()
      : z.string().refine(
          (val) => {
            try {
              return Buffer.from(val, "base64").length === 32;
            } catch {
              return false;
            }
          },
          {
            message:
              "ENCRYPTION_KEY_V1 must be a valid 32-byte base64-encoded string",
          },
        ),
    UPSTAND_GIT_PROVIDER_ALLOWED_HOSTS: z.string().optional(),
    UPSTAND_SECRET_PROVIDER_ALLOWED_HOSTS: z.string().optional(),
    UPSTAND_OUTBOUND_ALLOWED_HOSTS: z.string().optional(),
    UPSTAND_BACKUP_COMMAND_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(24 * 60 * 60_000)
      .default(30 * 60_000),
    UPSTAND_OPERATIONAL_MONITOR_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(60 * 60_000)
      .default(60_000),
    UPSTAND_QUEUE_ALERT_WAITING_THRESHOLD: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .default(1_000),
    UPSTAND_QUEUE_ALERT_FAILED_THRESHOLD: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .default(1),
    UPSTAND_OUTBOX_ALERT_PENDING_THRESHOLD: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .default(1_000),
    UPSTAND_OUTBOX_ALERT_DEAD_LETTER_THRESHOLD: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .default(1),
    UPSTAND_BACKUP_ALERT_MAX_AGE_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(30 * 24 * 60 * 60_000)
      .default(2 * 24 * 60 * 60_000),
    UPSTAND_BACKUP_ALERT_REQUIRE_SUCCESS: z
      .preprocess(
        (value) => value === "true" || value === "1" || value === true,
        z.boolean(),
      )
      .default(false),
    UPSTAND_AUDIT_LOG_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3_650)
      .default(365),
    UPSTAND_DOCKER_VERSION: z.string().min(1).optional(),
    UPSTAND_VERSION: z.string().min(1).optional(),
    UPSTAND_WEB_IMAGE: z.string().min(1).optional(),
    GITHUB_REPOSITORY: z.string().min(1).default("upstandplatform/upstand"),
    UPSTAND_GITHUB_TOKEN: z.string().min(1).optional(),
    GITHUB_TOKEN: z.string().min(1).optional(),
    UPSTAND_DOCS_HOST: z.string().optional(),
    UPSTAND_DASHBOARD_HOST: z.string().optional(),
    UPSTAND_API_HOST: z.string().optional(),
    UPSTAND_SERVER_UPSTREAM: z.string().optional(),
    UPSTAND_WEB_UPSTREAM: z.string().optional(),
    UPSTAND_FUMADOCS_UPSTREAM: z.string().optional(),
    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_MODEL: z.string().optional(),
  },
  runtimeEnv: process.env,
  skipValidation,
  emptyStringAsUndefined: true,
});

export const env = new Proxy(validatedEnv, {
  get(target: typeof validatedEnv, prop: string | symbol, receiver: unknown) {
    if (process.env.NODE_ENV === "test") {
      const val = typeof prop === "string" ? process.env[prop] : undefined;
      if (val !== undefined) {
        if (
          prop === "IS_CLOUD" ||
          prop === "UPSTAND_AUTO_UPDATE" ||
          prop === "TRUSTED_PROXY_HEADERS" ||
          prop === "UPSTAND_ALLOW_INSECURE_BOOTSTRAP" ||
          prop === "UPSTAND_BACKUP_ALERT_REQUIRE_SUCCESS"
        ) {
          return val === "true" || val === "1";
        }
        if (
          prop === "PORT" ||
          prop === "UPSTAND_DATABASE_POOL_MAX" ||
          prop === "UPSTAND_DATABASE_POOL_IDLE_TIMEOUT_MS" ||
          prop === "UPSTAND_DATABASE_POOL_CONNECTION_TIMEOUT_MS" ||
          prop === "UPSTAND_OPERATIONAL_MONITOR_INTERVAL_MS" ||
          prop === "UPSTAND_QUEUE_ALERT_WAITING_THRESHOLD" ||
          prop === "UPSTAND_QUEUE_ALERT_FAILED_THRESHOLD" ||
          prop === "UPSTAND_OUTBOX_ALERT_PENDING_THRESHOLD" ||
          prop === "UPSTAND_OUTBOX_ALERT_DEAD_LETTER_THRESHOLD" ||
          prop === "UPSTAND_BACKUP_ALERT_MAX_AGE_MS"
        ) {
          return Number(val);
        }
        return val;
      }
    }
    return Reflect.get(target, prop, receiver);
  },
});

/**
 * Return the inherited OS environment for a child process. Configuration
 * reads must use `env`; this helper exists only where an external command
 * intentionally needs the parent process environment plus explicit values.
 */
export function getInheritedEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return { ...process.env, ...overrides };
}

if (!skipValidation) {
  assertSecureProductionOrigins({
    nodeEnv: env.NODE_ENV,
    allowInsecureBootstrap: env.UPSTAND_ALLOW_INSECURE_BOOTSTRAP,
    platform: env.UPSTAND_PLATFORM,
    betterAuthUrl: env.BETTER_AUTH_URL,
    corsOrigin: env.CORS_ORIGIN,
  });
}

if (!process.env.NODE_ENV) {
  Object.defineProperty(process.env, "NODE_ENV", {
    configurable: true,
    enumerable: true,
    value: env.NODE_ENV,
    writable: true,
  });
}
