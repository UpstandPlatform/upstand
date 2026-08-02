import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const booleanFromEnvironment = z.preprocess(
  (value) => value === "true" || value === "1" || value === true,
  z.boolean(),
);

/** Validated configuration for local verification and E2E tooling. */
export const env = createEnv({
  server: {
    DOCKER_NETWORK: z.string().trim().min(1).default("upstand-network"),
    LOCAL_API_URL: z.url().default("http://localhost:3000"),
    LOCAL_WEB_URL: z.url().default("http://localhost:3001"),
    LOCAL_DOCS_URL: z.url().default("http://localhost:4000"),
    LOCAL_VERIFY_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    LOCAL_EXPECTED_MODE: z.enum(["cloud", "self-hosted"]).optional(),
    LOCAL_RUNTIME: z.enum(["compose", "host"]).default("compose"),
    OPERATIONAL_STATUS_AUTH_HEADER: z.string().trim().min(1).optional(),
    E2E_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
    E2E_BASE_URL: z.url().default("http://localhost:3000"),
    E2E_AUTH_COOKIE: z.string().min(1).default("e2e-auth-cookie"),
    E2E_API_KEY: z.string().min(1).default("e2e-api-key"),
    E2E_RESOURCE_ID: z.string().min(1).default("res-e2e-default"),
    E2E_REMOTE_SERVER_ID: z.string().min(1).default("server-e2e-default"),
    E2E_ORGANIZATION_ID: z.string().min(1).default("org-e2e-default"),
    E2E_BACKUP_DESTINATION_ID: z.string().min(1).default("backup-dest-default"),
    E2E_SERVER_AVAILABLE: booleanFromEnvironment.default(false),
    WEB_E2E_BASE_URL: z.url().default("http://127.0.0.1:3001"),
    PLAYWRIGHT_BROWSER: z
      .enum(["chromium", "firefox", "webkit"])
      .default("chromium"),
    CI: booleanFromEnvironment.default(false),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
