import type { ServiceScope } from "@circulo-ai/di";
import type { ApiBindings } from "@upstand/api/context";
import type { EvlogVariables } from "evlog/hono";

/** Request environment shared by every Hono route module. */
export type AppEnv = EvlogVariables & {
  Bindings: ApiBindings;
  Variables: {
    scope: ServiceScope;
  };
};
