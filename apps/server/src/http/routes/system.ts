import { getRateLimiterHealth } from "@upstand/api";
import { env } from "@upstand/env/server";
import { pingRedis, redis } from "@upstand/redis";
import {
  getPlatformCapabilities,
  resolveControlPlaneMode,
} from "@upstand/usecases";
import {
  GetSetupStatusUseCaseToken,
  UnitOfWorkToken,
} from "@upstand/usecases/tokens";
import type { Hono } from "hono";
import type { AppEnv } from "../types";

export type SystemRouteDependencies = {
  isShuttingDown(): boolean;
  isCaddyReady(): boolean;
  isSchedulesReady(): Promise<boolean>;
};

/** Registers the minimal first-run status endpoint before tenant routes. */
export function registerSetupStatusRoute(app: Hono<AppEnv>): void {
  app.get("/api/setup/status", async (c) => {
    const status = await c
      .get("scope")
      .resolve(GetSetupStatusUseCaseToken)
      .execute();
    const platformMode = resolveControlPlaneMode({
      platform: env.UPSTAND_PLATFORM,
      isCloud: env.IS_CLOUD,
    });
    return c.json({
      ...status,
      isCloud: platformMode === "cloud",
      platformMode,
      capabilities: getPlatformCapabilities(platformMode),
    });
  });
}

/** Registers generated API compatibility routes and process health endpoints. */
export function registerSystemRoutes(
  app: Hono<AppEnv>,
  dependencies: SystemRouteDependencies,
): void {
  app.get("/health/live", (c) => c.json({ status: "alive" }));

  app.get("/health/ready", async (c) => {
    const platformMode = resolveControlPlaneMode({
      platform: env.UPSTAND_PLATFORM,
      isCloud: env.IS_CLOUD,
    });
    const redisReady =
      platformMode === "desktop" ? true : await pingRedis(redis);
    const rateLimiterHealth = getRateLimiterHealth();
    const schedulesReady =
      platformMode === "desktop" ? true : await dependencies.isSchedulesReady();
    let databaseReady = false;
    try {
      const uow = c.get("scope").resolve(UnitOfWorkToken);
      await uow.resourceRepository.count();
      databaseReady = true;
    } catch (error) {
      c.get("log").error(error instanceof Error ? error : String(error), {
        message: "Database readiness check failed",
      });
    }

    const ready =
      !dependencies.isShuttingDown() &&
      (platformMode === "desktop" || dependencies.isCaddyReady()) &&
      (platformMode === "desktop" || redisReady) &&
      (platformMode === "desktop" || schedulesReady) &&
      databaseReady;
    return c.json(
      {
        status: ready ? "ready" : "not_ready",
        checks: {
          database: databaseReady,
          caddy: dependencies.isCaddyReady(),
          redis: redisReady,
          schedules: schedulesReady,
          rateLimiter: rateLimiterHealth,
        },
      },
      ready ? 200 : 503,
    );
  });

  app.get("/", (c) => c.text("OK"));
}
