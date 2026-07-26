import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  client: {
    NEXT_PUBLIC_SERVER_URL: z.url(),
    NEXT_PUBLIC_UPSTAND_VERSION: z.string().min(1).optional(),
  },
  runtimeEnv: {
    NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,
    NEXT_PUBLIC_UPSTAND_VERSION: process.env.NEXT_PUBLIC_UPSTAND_VERSION,
  },
  skipValidation:
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NODE_ENV === "test" ||
    (process.env.NODE_ENV !== "production" &&
      !!process.env.SKIP_ENV_VALIDATION),
  emptyStringAsUndefined: true,
});
