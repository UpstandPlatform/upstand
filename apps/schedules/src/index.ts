import { closeDb } from "@upstand/db";
import { env } from "@upstand/env/server";
import { closeRedis, redis } from "@upstand/redis";
import { UnitOfWorkToken } from "@upstand/usecases/tokens";
import { type DrainContext, initLogger, log } from "evlog";
import { createFsDrain } from "evlog/fs";
import { createOTLPDrain } from "evlog/otlp";
import { createDrainPipeline } from "evlog/pipeline";
import { getServiceProvider } from "./di";
import {
  type BackupOperationalSummary,
  createHealthServer,
  createOperationalMonitor,
} from "./health";
import { waitForMigrationBarrier } from "./migration-barrier";
import { SchedulerManager } from "./scheduler";
import { WorkerManager } from "./workers";

const fileDrain = createFsDrain({
  maxFiles: 7,
  maxSizePerFile: 16 * 1024 * 1024,
});
const otlpEndpoint =
  env.OTLP_ENDPOINT?.trim() || env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
const otlpDrain = otlpEndpoint
  ? createOTLPDrain({
      endpoint: otlpEndpoint,
      serviceName: "upstand-schedules",
    })
  : undefined;

const drainAdapter = async (context: DrainContext | DrainContext[]) => {
  await Promise.all([
    fileDrain(context),
    ...(otlpDrain ? [otlpDrain(context)] : []),
  ]);
};
const drain = createDrainPipeline<DrainContext>({
  batch: { size: 50, intervalMs: 5_000 },
  retry: {
    maxAttempts: 3,
    backoff: "exponential",
    initialDelayMs: 500,
    maxDelayMs: 5_000,
  },
  maxBufferSize: 2_000,
  onDropped: (events, error) => {
    process.stderr.write(
      `${JSON.stringify({ service: "upstand-schedules", event: "telemetry_dropped", count: events.length, reason: error?.message ?? "buffer_overflow" })}\n`,
    );
  },
})(async (batch) => drainAdapter(batch));

initLogger({
  env: { service: "upstand-schedules" },
  drain,
});

log.info({ message: "Initializing Upstand Schedules Service 🚀" });

await waitForMigrationBarrier({
  migrationId: env.UPSTAND_MIGRATION_ID,
  skipMigrations: env.UPSTAND_SKIP_MIGRATIONS,
  redis,
});

let shuttingDown = false;

const schedulerManager = new SchedulerManager();
const workerManager = new WorkerManager();

await schedulerManager.start();
await workerManager.start();

const healthApp = createHealthServer(workerManager, () => shuttingDown, {
  getOutboxSummary: async () => {
    const scope = getServiceProvider().createScope();
    try {
      return await scope
        .resolve(UnitOfWorkToken)
        .outboxRepository.getOperationalSummary();
    } finally {
      await scope.dispose();
    }
  },
  getBackupSummary: async (): Promise<BackupOperationalSummary> => {
    const scope = getServiceProvider().createScope();
    try {
      const backupRuns = scope.resolve(UnitOfWorkToken).backupRunRepository;
      const [succeeded, failed] = await Promise.all([
        backupRuns.findByStatus("succeeded", 1),
        backupRuns.findByStatus("failed", 1),
      ]);
      return {
        lastSucceededAt: succeeded[0]?.completedAt?.toISOString() ?? null,
        lastFailedAt: failed[0]?.completedAt?.toISOString() ?? null,
      };
    } finally {
      await scope.dispose();
    }
  },
});

const operationalMonitor = createOperationalMonitor(
  () => healthApp.readOperationalStatus(),
  {
    intervalMs: env.UPSTAND_OPERATIONAL_MONITOR_INTERVAL_MS,
    thresholds: {
      queueWaiting: env.UPSTAND_QUEUE_ALERT_WAITING_THRESHOLD,
      queueFailed: env.UPSTAND_QUEUE_ALERT_FAILED_THRESHOLD,
      outboxPending: env.UPSTAND_OUTBOX_ALERT_PENDING_THRESHOLD,
      outboxDeadLetter: env.UPSTAND_OUTBOX_ALERT_DEAD_LETTER_THRESHOLD,
      backupMaxAgeMs: env.UPSTAND_BACKUP_ALERT_MAX_AGE_MS,
      backupRequireSuccess: env.UPSTAND_BACKUP_ALERT_REQUIRE_SUCCESS,
    },
    onAlert: (alert) => {
      log.error({
        message: alert.message,
        operationalAlert: alert.code,
        ...alert.details,
      });
    },
  },
);

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  operationalMonitor.stop();
  log.info({
    message: "Graceful shutdown of Schedules Service started",
    signal,
  });

  const drainWork = Promise.allSettled([
    schedulerManager.stop(),
    workerManager.stop(),
  ]);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(() => resolve("timeout"), 60_000);
    timeout.unref?.();
  });

  const result = await Promise.race([drainWork, timedOut]);
  if (timeout) clearTimeout(timeout);

  if (result === "timeout") {
    log.error({
      message: "Schedules Service shutdown timed out; forcing exit",
      signal,
    });
  }

  await healthApp.close();
  await closeRedis(redis);
  await closeDb();
  log.info({
    message: "Graceful shutdown of Schedules Service completed",
    signal,
  });
  await drain.flush();
  process.exit(result === "timeout" ? 1 : 0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

const port = env.SCHEDULES_PORT || env.PORT;

export default {
  hostname: env.HOST,
  port,
  fetch: healthApp.fetch,
};
