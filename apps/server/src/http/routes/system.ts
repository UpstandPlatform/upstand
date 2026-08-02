import { getRateLimiterHealth } from "@upstand/api";
import { env } from "@upstand/env/server";
import { pingRedis, redis } from "@upstand/redis";
import {
  getPlatformCapabilities,
  resolveControlPlaneMode,
} from "@upstand/usecases";
import type { DatabaseHealthPort } from "@upstand/usecases/ports/database-health";
import {
  DatabaseHealthToken,
  GetSetupStatusUseCaseToken,
} from "@upstand/usecases/tokens";
import type { Hono } from "hono";
import type { AppEnv } from "../types";

export type SystemRouteDependencies = {
  isShuttingDown(): boolean;
  isCaddyReady(): boolean;
  isSchedulesReady(): Promise<boolean>;
  isMonitoringReady?: () => boolean;
  monitoringRequired?: boolean;
};

export function isRequiredMonitoringReady(
  monitoringRequired: boolean,
  monitoringReady: boolean,
): boolean {
  return !monitoringRequired || monitoringReady;
}

export async function probeDatabase(
  databaseHealth: DatabaseHealthPort,
  timeoutMs = 1_000,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      databaseHealth.ping(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error(`Database ping timed out after ${timeoutMs}ms`)),
          Math.max(1, Math.floor(timeoutMs)),
        );
        timeout.unref?.();
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

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
    const databaseHealth = c.get("scope").resolve(DatabaseHealthToken);
    const databaseReady = await probeDatabase(databaseHealth);
    const monitoringReady = dependencies.isMonitoringReady?.() ?? true;
    const monitoringCheck = isRequiredMonitoringReady(
      dependencies.monitoringRequired ?? false,
      monitoringReady,
    );
    if (!databaseReady) {
      c.get("log").error("Database readiness check failed", {
        message: "Database readiness check failed",
      });
    }

    const ready =
      !dependencies.isShuttingDown() &&
      (platformMode === "desktop" || dependencies.isCaddyReady()) &&
      (platformMode === "desktop" || redisReady) &&
      (platformMode === "desktop" || schedulesReady) &&
      databaseReady &&
      monitoringCheck;
    return c.json(
      {
        status: ready ? "ready" : "not_ready",
        checks: {
          database: databaseReady,
          caddy: dependencies.isCaddyReady(),
          redis: redisReady,
          schedules: schedulesReady,
          monitoring: monitoringCheck,
          rateLimiter: rateLimiterHealth,
        },
      },
      ready ? 200 : 503,
    );
  });

  app.get("/", (c) => c.text("OK"));
}
