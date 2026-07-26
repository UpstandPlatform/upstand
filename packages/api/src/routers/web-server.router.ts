import type { IUnitOfWork } from "@upstand/domain";
import { env } from "@upstand/env/server";
import {
  AccessLogCleanupCronSchema,
  AccessLogQuerySchema,
  aggregateAccessLogStats,
  getDockerInstance,
  queryAccessLogEntries,
  TriggerUpdateInputSchema,
  UpdateWebServerSettingsInputSchema,
} from "@upstand/usecases";
import {
  CaddyServiceToken,
  GetUpdateStatusUseCaseToken,
  GetWebServerLogsUseCaseToken,
  GetWebServerSettingsUseCaseToken,
  TriggerUpdateUseCaseToken,
  UnitOfWorkToken,
  UpdateWebServerSettingsUseCaseToken,
} from "@upstand/usecases/tokens";
import { z } from "zod";

import { getErrorMessage, handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { requireInstanceOwnerContext } from "../instance-access";
import { webServerMaintenanceProcedures } from "./web-server/maintenance";
import {
  cleanDockerLogs,
  dockerLogBuffer,
  getRunningServiceContainer,
  requireWebServerOwner,
  UPSTAND_SERVER_SERVICE,
} from "./web-server.shared";

async function getSecurityAudit(uow: IUnitOfWork) {
  const docker = getDockerInstance();
  const checks: Array<{
    id: string;
    title: string;
    status: "pass" | "warn" | "fail";
    detail: string;
  }> = [];

  try {
    const info = await docker.info();
    checks.push({
      id: "docker-version",
      title: "Docker engine reachable",
      status: "pass",
      detail: `${info.ServerVersion || "unknown"} on ${info.OperatingSystem || "unknown"}`,
    });
    checks.push({
      id: "swarm",
      title: "Swarm control plane",
      status: info.Swarm?.LocalNodeState === "active" ? "pass" : "warn",
      detail: `Local node state: ${info.Swarm?.LocalNodeState || "unknown"}`,
    });
  } catch (error) {
    checks.push({
      id: "docker-version",
      title: "Docker engine reachable",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const network = await docker.getNetwork(env.DOCKER_NETWORK).inspect();
    const valid = network.Driver === "overlay" && network.Attachable === true;
    checks.push({
      id: "managed-network",
      title: "Managed ingress network",
      status: valid ? "pass" : "fail",
      detail: valid
        ? "Attachable overlay network is configured."
        : "The managed network must be an attachable overlay network.",
    });
  } catch (error) {
    checks.push({
      id: "managed-network",
      title: "Managed ingress network",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const settings = await uow.webServerSettingsRepository.findGlobal();
  const snippets = `${settings?.globalCaddyfile || ""}\n${settings?.caddySnippets || ""}`;
  checks.push({
    id: "caddy-admin",
    title: "Caddy admin surface",
    status: snippets.includes(":2019") ? "fail" : "pass",
    detail: snippets.includes(":2019")
      ? "Caddy admin port appears to be exposed in the configured snippet."
      : "No Caddy admin listener was found in environment configuration.",
  });

  const failed = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  return {
    generatedAt: new Date().toISOString(),
    score: Math.max(0, 100 - failed * 35 - warnings * 10),
    checks,
  };
}

export const webServerRouter = router({
  ...webServerMaintenanceProcedures,
  securityAudit: twoFactorVerifiedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx }) => {
      await requireInstanceOwnerContext(ctx);
      try {
        return await getSecurityAudit(ctx.scope.resolve(UnitOfWorkToken));
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  getSettings: twoFactorVerifiedProcedure.query(async ({ ctx }) => {
    await requireWebServerOwner(ctx);
    const useCase = ctx.scope.resolve(GetWebServerSettingsUseCaseToken);
    try {
      return await useCase.execute();
    } catch (error) {
      handleUseCaseError(error, ctx.log);
    }
  }),

  updateSettings: twoFactorVerifiedProcedure
    .input(UpdateWebServerSettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      await requireWebServerOwner(ctx);
      const useCase = ctx.scope.resolve(UpdateWebServerSettingsUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  accessLogStatus: twoFactorVerifiedProcedure.query(async ({ ctx }) => {
    await requireWebServerOwner(ctx);
    const uow = ctx.scope.resolve(UnitOfWorkToken);
    const settings = await uow.webServerSettingsRepository.findGlobal();
    return {
      enabled: settings?.accessLogsEnabled ?? false,
      cleanupCron: settings?.accessLogCleanupCron ?? "0 3 * * *",
    };
  }),

  toggleAccessLogs: twoFactorVerifiedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await requireWebServerOwner(ctx);
      const useCase = ctx.scope.resolve(UpdateWebServerSettingsUseCaseToken);
      try {
        const settings = await useCase.execute({
          accessLogsEnabled: input.enabled,
        });
        return { enabled: settings?.accessLogsEnabled ?? input.enabled };
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  updateAccessLogCleanup: twoFactorVerifiedProcedure
    .input(z.object({ cron: AccessLogCleanupCronSchema }))
    .mutation(async ({ ctx, input }) => {
      await requireWebServerOwner(ctx);
      const useCase = ctx.scope.resolve(UpdateWebServerSettingsUseCaseToken);
      try {
        const settings = await useCase.execute({
          accessLogCleanupCron: input.cron,
        });
        return { cleanupCron: settings?.accessLogCleanupCron ?? input.cron };
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  accessLogs: twoFactorVerifiedProcedure
    .input(AccessLogQuerySchema)
    .query(async ({ ctx, input }) => {
      await requireWebServerOwner(ctx);
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const settings = await uow.webServerSettingsRepository.findGlobal();
      if (!settings?.accessLogsEnabled) {
        return { entries: [], total: 0, pageCount: 1, page: input.page };
      }
      const content = await ctx.scope
        .resolve(CaddyServiceToken)
        .getAccessLogs();
      return { ...queryAccessLogEntries(content, input), page: input.page };
    }),

  accessLogStats: twoFactorVerifiedProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      await requireWebServerOwner(ctx);
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const settings = await uow.webServerSettingsRepository.findGlobal();
      if (!settings?.accessLogsEnabled) return [];
      const content = await ctx.scope
        .resolve(CaddyServiceToken)
        .getAccessLogs();
      return aggregateAccessLogStats(content, input.from, input.to);
    }),

  getLogs: twoFactorVerifiedProcedure
    .input(z.object({ tail: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      await requireWebServerOwner(ctx);
      const useCase = ctx.scope.resolve(GetWebServerLogsUseCaseToken);
      try {
        return await useCase.execute(input.tail);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  getServerLogs: twoFactorVerifiedProcedure
    .input(z.object({ tail: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      await requireWebServerOwner(ctx);
      const docker = getDockerInstance();
      const tail = input.tail || 100;
      try {
        const service = docker.getService(UPSTAND_SERVER_SERVICE);
        const logBuffer = await service.logs({
          stdout: true,
          stderr: true,
          tail,
        });
        const text = cleanDockerLogs(await dockerLogBuffer(logBuffer));
        if (text && !text.includes("no such service")) return text;
      } catch {
        // Fall through to container lookup
      }

      try {
        const container = await getRunningServiceContainer(
          UPSTAND_SERVER_SERVICE,
        );
        if (container) {
          const logBuffer = await container.logs({
            stdout: true,
            stderr: true,
            tail,
          });
          return cleanDockerLogs(await dockerLogBuffer(logBuffer));
        }
      } catch (err) {
        return `Failed to fetch server logs: ${getErrorMessage(err, "Unknown error")}`;
      }

      return "No active Upstand server process or container found.";
    }),

  getUpdateData: twoFactorVerifiedProcedure.query(async ({ ctx }) => {
    await requireWebServerOwner(ctx);
    const useCase = ctx.scope.resolve(GetUpdateStatusUseCaseToken);
    try {
      return await useCase.execute();
    } catch (error) {
      handleUseCaseError(error, ctx.log);
    }
  }),

  checkForUpdates: twoFactorVerifiedProcedure.mutation(async ({ ctx }) => {
    await requireWebServerOwner(ctx);
    const useCase = ctx.scope.resolve(GetUpdateStatusUseCaseToken);
    try {
      return await useCase.execute({ forceRefresh: true });
    } catch (error) {
      handleUseCaseError(error, ctx.log);
    }
  }),

  triggerUpdate: twoFactorVerifiedProcedure
    .input(TriggerUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      await requireWebServerOwner(ctx);
      const useCase = ctx.scope.resolve(TriggerUpdateUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  getSystemStatus: twoFactorVerifiedProcedure.query(async ({ ctx }) => {
    await requireWebServerOwner(ctx);

    let dbConnected = false;
    try {
      const { pool } = await import("@upstand/db");
      dbConnected = await Promise.race([
        pool
          .query("SELECT 1")
          .then((res) => res !== null && res.rowCount !== null),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 1000),
        ),
      ]);
    } catch {
      dbConnected = false;
    }

    let redisConnected = false;
    try {
      const { redis, pingRedis } = await import("@upstand/redis");
      redisConnected = await Promise.race([
        pingRedis(redis),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 1000),
        ),
      ]);
    } catch {
      redisConnected = false;
    }

    const now = new Date();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const offsetMinutes = -now.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absMinutes = Math.abs(offsetMinutes);
    const hours = String(Math.floor(absMinutes / 60)).padStart(2, "0");
    const mins = String(absMinutes % 60).padStart(2, "0");
    const offsetStr = `UTC${sign}${hours}:${mins}`;

    let timeZoneAbbr = "UTC";
    try {
      timeZoneAbbr =
        new Intl.DateTimeFormat("en-US", {
          timeZoneName: "short",
          timeZone,
        })
          .formatToParts(now)
          .find((p) => p.type === "timeZoneName")?.value || "UTC";
    } catch {}

    return {
      database: dbConnected ? "connected" : "disconnected",
      redis: redisConnected ? "connected" : "disconnected",
      server: "connected",
      serverTime: now.toISOString(),
      timeZone: timeZoneAbbr,
      timeZoneOffset: offsetStr,
      timeZoneId: timeZone,
    };
  }),
});
