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
    /** Internal API origin used only by server-rendered web requests. */
    UPSTAND_SERVER_INTERNAL_URL: z.url().optional(),
  },
  client: {
    NEXT_PUBLIC_SERVER_URL: z.url(),
    NEXT_PUBLIC_UPSTAND_VERSION: z.string().min(1).optional(),
  },
  runtimeEnv: {
    UPSTAND_SERVER_INTERNAL_URL: process.env.UPSTAND_SERVER_INTERNAL_URL,
    NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,
    NEXT_PUBLIC_UPSTAND_VERSION: process.env.NEXT_PUBLIC_UPSTAND_VERSION,
  },
  skipValidation,
  emptyStringAsUndefined: true,
});
