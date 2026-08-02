import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const skipValidation =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.NODE_ENV === "test" ||
  (process.env.NODE_ENV !== "production" &&
    ["1", "true"].includes(
      process.env.SKIP_ENV_VALIDATION?.trim().toLowerCase() ?? "",
    ));

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    SKIP_TYPECHECK: z.string().optional(),
    /** Internal API origin used only by server-rendered web requests. */
    UPSTAND_SERVER_INTERNAL_URL: z.url().optional(),
    OTLP_ENDPOINT: z.url().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  },
  client: {
    NEXT_PUBLIC_SERVER_URL: z.url().default("http://localhost:3000"),
    NEXT_PUBLIC_UPSTAND_VERSION: z.string().min(1).optional(),
    NEXT_PUBLIC_FUMADOCS_URL: z.url().default("http://localhost:4000"),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    SKIP_TYPECHECK: process.env.SKIP_TYPECHECK,
    UPSTAND_SERVER_INTERNAL_URL: process.env.UPSTAND_SERVER_INTERNAL_URL,
    OTLP_ENDPOINT: process.env.OTLP_ENDPOINT,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,
    NEXT_PUBLIC_UPSTAND_VERSION: process.env.NEXT_PUBLIC_UPSTAND_VERSION,
    NEXT_PUBLIC_FUMADOCS_URL: process.env.NEXT_PUBLIC_FUMADOCS_URL,
  },
  skipValidation,
  emptyStringAsUndefined: true,
});
