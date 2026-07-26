import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv } from "@t3-oss/env-core";
import dotenv from "dotenv";
import { z } from "zod";

const currentDir =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(currentDir, "../../..");

dotenv.config();
dotenv.config({ path: path.join(monorepoRoot, "apps", "server", ".env") });
dotenv.config({ path: path.join(monorepoRoot, ".env") });

const isTest = process.env.NODE_ENV === "test";

const validatedEnv = createEnv({
  server: {
    DATABASE_URL: isTest ? z.string().optional() : z.string().min(1),
    BETTER_AUTH_SECRET: isTest ? z.string().optional() : z.string().min(32),
    BETTER_AUTH_URL: isTest ? z.string().optional() : z.url(),
    CORS_ORIGIN: isTest ? z.string().optional() : z.url(),
    TRUSTED_PROXY_CIDRS: z.string().default(""),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    IS_CLOUD: z
      .preprocess(
        (val) => val === "true" || val === "1" || val === true,
        z.boolean(),
      )
      .default(false),
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
    SERVER_ID: z.string().min(1).optional(),
    UPSTAND_CONTROL_PLANE_SSH_HOST_KEY_FINGERPRINT: z
      .string()
      .min(1)
      .optional(),
    PORT: z.coerce.number().default(3000),
    UPSTAND_MONITORING_IMAGE: z.string().min(1).optional(),
    DB_MIGRATIONS_PATH: z.string().min(1).optional(),
    UPGAL_MCP_SERVERS: z.string().optional(),
    UPGAL_WEB_SEARCH_API_KEY: z.string().optional(),
    UPGAL_WEB_SEARCH_BASE_URL: z
      .url()
      .default("https://api.search.brave.com/res/v1/web/search"),
    UPSTAND_INSTANCE_OWNER_USER_ID: z.string().min(1).optional(),
    DOCKER_NETWORK: z.string().min(1).default("upstand-network"),
    REDIS_HOST: z.string().optional(),
    REDIS_PORT: z.coerce.number().optional(),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_URL: z.string().min(1).optional(),
    UPSTAND_BASE_URL: z.url().optional(),
    APP_URL: z.url().optional(),
    UPSTAND_POSTGRES_CONTAINER: z.string().min(1).optional(),
    ENCRYPTION_KEY_V1: isTest ? z.string().optional() : z.string().min(1),
    UPSTAND_GIT_PROVIDER_ALLOWED_HOSTS: z.string().optional(),
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
  skipValidation:
    process.env.NEXT_PHASE === "phase-production-build" ||
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.SKIP_ENV_VALIDATION === "1" ||
    process.env.SKIP_ENV_VALIDATION === "true" ||
    !process.env.DATABASE_URL,
  emptyStringAsUndefined: true,
});

export const env = new Proxy(validatedEnv, {
  get(target: typeof validatedEnv, prop: string | symbol, receiver: unknown) {
    if (process.env.NODE_ENV === "test") {
      const val = typeof prop === "string" ? process.env[prop] : undefined;
      if (val !== undefined) {
        if (prop === "IS_CLOUD" || prop === "UPSTAND_AUTO_UPDATE") {
          return val === "true" || val === "1";
        }
        if (prop === "PORT") {
          return Number(val);
        }
        return val;
      }
    }
    return Reflect.get(target, prop, receiver);
  },
});

if (!process.env.NODE_ENV) {
  Object.defineProperty(process.env, "NODE_ENV", {
    configurable: true,
    enumerable: true,
    value: env.NODE_ENV,
    writable: true,
  });
}
