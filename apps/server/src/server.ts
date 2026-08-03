import { auth } from "@upstand/api/auth";
import { closeDb } from "@upstand/db";
import { env } from "@upstand/env/server";
import { closeRemoteDockerProxies } from "@upstand/infrastructure";
import { closeRedis, getRedisWithTimeout, redis } from "@upstand/redis";
import {
  GetWebServerSettingsUseCaseToken,
  PublishNotificationUseCaseToken,
} from "@upstand/usecases/tokens";
import { type DrainContext, initLogger, log } from "evlog";
import {
  type BetterAuthInstance,
  createAuthMiddleware,
} from "evlog/better-auth";
import { createFsDrain } from "evlog/fs";
import { evlog } from "evlog/hono";
import { createOTLPDrain } from "evlog/otlp";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import { getServiceProvider } from "./di";
import { registerHttpMiddleware } from "./http/middleware";
import { registerAiRoutes } from "./http/routes/ai";
import { registerAuthRoutes } from "./http/routes/auth";
import { registerCliDeviceAuthRoutes } from "./http/routes/cli-device-auth";
import { registerDeploymentRoutes } from "./http/routes/deployments";
import { registerMonitoringRoutes } from "./http/routes/monitoring";
import { registerProviderRoutes } from "./http/routes/providers";
import { registerScimRoutes } from "./http/routes/scim";
import {
  registerSetupStatusRoute,
  registerSystemRoutes,
} from "./http/routes/system";
import { registerTerminalRoutes } from "./http/routes/terminal";
import { registerApiTransports } from "./http/routes/transports";
import { registerWebhookRoutes } from "./http/routes/webhooks";
import type { AppEnv } from "./http/types";
import { initializeMonitoring } from "./monitoring-agent";
import { runDatabaseMigrations } from "./startup";
import { terminalBroker } from "./terminal-broker";

const fileDrain = createFsDrain({
  maxFiles: 7,
  maxSizePerFile: 16 * 1024 * 1024,
});
const otlpEndpoint =
  env.OTLP_ENDPOINT?.trim() || env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
const otlpDrain = otlpEndpoint
  ? createOTLPDrain({
      endpoint: otlpEndpoint,
      serviceName: "upstand-server",
    })
  : undefined;

const drain = async (context: DrainContext | DrainContext[]) => {
  await Promise.allSettled([
    fileDrain(context),
    ...(otlpDrain ? [otlpDrain(context)] : []),
  ]);
};

initLogger({
  env: { service: "upstand-server" },
  drain,
});

async function waitForMigrationBarrier() {
  if (!env.UPSTAND_SKIP_MIGRATIONS || !env.UPSTAND_MIGRATION_ID) return;

  const key = `upstand:migrations:ready:${env.UPSTAND_MIGRATION_ID}`;
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      if ((await getRedisWithTimeout(redis, key, 1_000)) === "ready") return;
    } catch {
      // Redis readiness is checked again on the next attempt.
    }
    await Bun.sleep(1_000);
  }

  throw new Error("Timed out waiting for the deployment database migration");
}

await waitForMigrationBarrier();

if (!env.UPSTAND_SKIP_MIGRATIONS) {
  await runDatabaseMigrations();
}

const identifyUser = createAuthMiddleware(auth as BetterAuthInstance, {
  exclude: [
    "/api/auth/**",
    "/api/providers/github/setup",
    "/api/providers/gitlab/setup",
    "/api/providers/gitea/setup",
    "/api/scim/**",
  ],
  maskEmail: true,
});

const app = new Hono<AppEnv>();
let shuttingDown = false;
let caddyReady = false;
let monitoringReady = env.NODE_ENV !== "production";
let httpServer: Bun.Server<unknown> | null = null;

app.use(evlog());

registerHttpMiddleware(app, {
  getServiceProvider,
  identifyUser,
});

registerAuthRoutes(app);

registerCliDeviceAuthRoutes(app);

registerTerminalRoutes(app);

registerMonitoringRoutes(app);

registerDeploymentRoutes(app);

registerWebhookRoutes(app);

registerSetupStatusRoute(app);

registerScimRoutes(app);

registerAiRoutes(app);

registerProviderRoutes(app);

registerApiTransports(app);

registerSystemRoutes(app, {
  isShuttingDown: () => shuttingDown,
  isCaddyReady: () => caddyReady,
  isSchedulesReady: async () => {
    const endpoint = env.UPSTAND_SCHEDULES_INTERNAL_URL;
    if (!endpoint) return true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_000);
    try {
      const response = await fetch(
        `${endpoint.replace(/\/$/, "")}/health/ready`,
        {
          signal: controller.signal,
        },
      );
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  },
  isMonitoringReady: () => monitoringReady,
  monitoringRequired: env.NODE_ENV === "production",
});

// Initialize Caddy Web Server on Startup
const caddyInitScope = getServiceProvider().createScope();
const getCaddySettingsUseCase = caddyInitScope.resolve(
  GetWebServerSettingsUseCaseToken,
);
getCaddySettingsUseCase
  .execute({ reconcile: true })
  .then(() => {
    caddyReady = true;
    log.info({ message: "Caddy Web Server initialized successfully. ✅" });
  })
  .catch((err) =>
    log.error(
      err instanceof Error ? err.message : String(err),
      "Failed to initialize Caddy Web Server",
    ),
  )
  .finally(() => caddyInitScope.dispose());

initializeMonitoring()
  .then(() => {
    monitoringReady = true;
  })
  .catch((err) => {
    monitoringReady = false;
    log.error({
      message: "Monitoring initialization error; readiness will fail closed",
      err: err instanceof Error ? err.message : String(err),
    });
  });

log.info({ message: "Upstand Control Plane API Server started 🚀" });

const completedUpdateVersion = env.UPSTAND_UPDATE_COMPLETION_VERSION;
if (completedUpdateVersion) {
  setTimeout(() => {
    const scope = getServiceProvider().createScope();
    void scope
      .resolve(PublishNotificationUseCaseToken)
      .execute({
        event: "upstand_update_completed",
        idempotencyKey: `upstand-update-completed:${completedUpdateVersion}`,
        title: "Upstand update completed",
        message: `Upstand has finished updating to version ${completedUpdateVersion}.`,
        metadata: { version: completedUpdateVersion },
      })
      .catch((error: unknown) => {
        log.warn({
          message: "Unable to queue Upstand update completion notification",
          err: error instanceof Error ? error.message : error,
        });
      })
      .finally(() => scope.dispose());
  }, 15_000).unref?.();
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ message: "Graceful shutdown started", signal });

  terminalBroker.stop();
  if (httpServer) {
    await Promise.race([httpServer.stop(), Bun.sleep(30_000)]);
    if (httpServer) await httpServer.stop(true);
    httpServer = null;
  }
  await closeRedis(redis);
  closeRemoteDockerProxies();
  await closeDb();
  log.info({ message: "Graceful shutdown completed", signal });
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

export default {
  // Bind on all interfaces so the same process works for host development,
  // Docker port forwarding, and the self-hosted runtime.
  hostname: env.HOST,
  port: env.PORT,
  fetch: (request: Request, bunServer: Bun.Server<unknown>) => {
    httpServer = bunServer;
    return app.fetch(request, { server: bunServer });
  },
  websocket,
};
