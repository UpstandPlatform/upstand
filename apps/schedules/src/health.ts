import type { OutboxOperationalSummary } from "@upstand/domain";
import { pingRedis, redis } from "@upstand/redis";
import {
  BACKUP_RUN_QUEUE,
  getJobTelemetryMetrics,
  NOTIFICATION_DELIVERY_QUEUE,
} from "@upstand/usecases";
import { type Context, Hono } from "hono";
import { QueueHealthChecker, type QueueHealthStatus } from "./queues";
import type { WorkerManager } from "./workers";

export type HealthDependencies = {
  isRedisReady?: () => Promise<boolean>;
  inspectQueue?: (queueName: string) => Promise<QueueHealthStatus>;
  getOutboxSummary?: () => Promise<OutboxOperationalSummary>;
  getBackupSummary?: () => Promise<BackupOperationalSummary>;
};

export type BackupOperationalSummary = {
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  lastSucceededRestoreTestedAt?: string | null;
};

export type OperationalStatus = {
  database: boolean;
  redis: boolean;
  queues: QueueHealthStatus[];
  outbox: OutboxOperationalSummary | null;
  backup: BackupOperationalSummary | null;
};

type OperationalMetricsOptions = {
  workersReady: boolean;
  uptimeSeconds: number;
  now?: number;
};

const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

export function renderOperationalMetrics(
  status: OperationalStatus,
  options: OperationalMetricsOptions,
): string {
  const lines: string[] = [];
  const metric = (name: string, value: boolean | number, labels?: string) => {
    lines.push(
      `${name}${labels ? `{${labels}}` : ""} ${value === true ? 1 : value === false ? 0 : value}`,
    );
  };
  const help = (name: string, description: string, type = "gauge") => {
    lines.push(`# HELP ${name} ${description}`);
    lines.push(`# TYPE ${name} ${type}`);
  };

  help(
    "upstand_schedules_collection_success",
    "Whether the schedules operational status was collected successfully.",
  );
  metric("upstand_schedules_collection_success", true);
  help(
    "upstand_schedules_workers_ready",
    "Whether schedules workers are ready.",
  );
  metric("upstand_schedules_workers_ready", options.workersReady);
  help(
    "upstand_schedules_database_ready",
    "Whether database-backed operational status is available.",
  );
  metric("upstand_schedules_database_ready", status.database);
  help("upstand_schedules_redis_ready", "Whether Redis is reachable.");
  metric("upstand_schedules_redis_ready", status.redis);
  help(
    "upstand_schedules_uptime_seconds",
    "Schedules process uptime in seconds.",
  );
  metric(
    "upstand_schedules_uptime_seconds",
    Math.max(0, Math.floor(options.uptimeSeconds)),
  );

  help(
    "upstand_schedules_queue_healthy",
    "Whether a BullMQ queue health check passed.",
  );
  help(
    "upstand_schedules_queue_waiting",
    "Number of waiting jobs in a BullMQ queue.",
  );
  help(
    "upstand_schedules_queue_failed",
    "Number of failed jobs in a BullMQ queue.",
  );
  for (const queue of status.queues) {
    const labels = `queue="${escapePrometheusLabel(queue.name)}"`;
    metric("upstand_schedules_queue_healthy", queue.isHealthy, labels);
    metric("upstand_schedules_queue_waiting", queue.waitingCount, labels);
    metric("upstand_schedules_queue_failed", queue.failedCount, labels);
  }

  help(
    "upstand_schedules_job_executions_total",
    "Background job executions by bounded operation and outcome.",
    "counter",
  );
  help(
    "upstand_schedules_job_duration_seconds_total",
    "Total background job execution time by bounded operation and outcome.",
    "counter",
  );
  for (const job of getJobTelemetryMetrics()) {
    const labels = `operation="${escapePrometheusLabel(job.operation)}",outcome="${job.outcome}"`;
    metric("upstand_schedules_job_executions_total", job.count, labels);
    metric(
      "upstand_schedules_job_duration_seconds_total",
      job.durationSeconds,
      labels,
    );
  }

  help(
    "upstand_schedules_outbox_pending",
    "Number of pending transactional outbox records.",
  );
  help(
    "upstand_schedules_outbox_publishing",
    "Number of publishing transactional outbox records.",
  );
  help(
    "upstand_schedules_outbox_dead_letter",
    "Number of dead-letter transactional outbox records.",
  );
  metric("upstand_schedules_outbox_pending", status.outbox?.pending ?? 0);
  metric("upstand_schedules_outbox_publishing", status.outbox?.publishing ?? 0);
  metric(
    "upstand_schedules_outbox_dead_letter",
    status.outbox?.deadLetter ?? 0,
  );

  const lastSucceededAt = status.backup?.lastSucceededAt
    ? Date.parse(status.backup.lastSucceededAt)
    : Number.NaN;
  const lastFailedAt = status.backup?.lastFailedAt
    ? Date.parse(status.backup.lastFailedAt)
    : Number.NaN;
  const now = options.now ?? Date.now();
  help(
    "upstand_schedules_backup_success_present",
    "Whether at least one successful backup timestamp is available.",
  );
  metric(
    "upstand_schedules_backup_success_present",
    Number.isFinite(lastSucceededAt),
  );
  help(
    "upstand_schedules_backup_last_success_timestamp_seconds",
    "Unix timestamp of the most recent successful backup, or zero when absent.",
  );
  metric(
    "upstand_schedules_backup_last_success_timestamp_seconds",
    Number.isFinite(lastSucceededAt) ? lastSucceededAt / 1000 : 0,
  );
  help(
    "upstand_schedules_backup_last_failure_timestamp_seconds",
    "Unix timestamp of the most recent failed backup, or zero when absent.",
  );
  metric(
    "upstand_schedules_backup_last_failure_timestamp_seconds",
    Number.isFinite(lastFailedAt) ? lastFailedAt / 1000 : 0,
  );
  help(
    "upstand_schedules_backup_age_seconds",
    "Age of the most recent successful backup in seconds, or zero when absent.",
  );
  metric(
    "upstand_schedules_backup_age_seconds",
    Number.isFinite(lastSucceededAt)
      ? Math.max(0, (now - lastSucceededAt) / 1000)
      : 0,
  );
  help(
    "upstand_schedules_backup_restore_verified",
    "Whether the most recent successful backup has a recorded restore verification.",
  );
  metric(
    "upstand_schedules_backup_restore_verified",
    Boolean(
      status.backup?.lastSucceededRestoreTestedAt &&
        Number.isFinite(Date.parse(status.backup.lastSucceededRestoreTestedAt)),
    ),
  );

  return `${lines.join("\n")}\n`;
}

export { PROMETHEUS_CONTENT_TYPE };

function escapePrometheusLabel(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n");
}

export type OperationalAlertThresholds = {
  queueWaiting: number;
  queueFailed: number;
  outboxPending: number;
  outboxDeadLetter: number;
  backupMaxAgeMs: number;
  backupRequireSuccess: boolean;
  backupRequireRestoreVerification?: boolean;
};

export type OperationalAlert = {
  code:
    | "operational_status_unavailable"
    | "database_unhealthy"
    | "redis_unhealthy"
    | "queue_unhealthy"
    | "queue_waiting_threshold"
    | "queue_failed_threshold"
    | "outbox_pending_threshold"
    | "outbox_dead_letter_threshold"
    | "backup_failed"
    | "backup_missing"
    | "backup_stale"
    | "backup_restore_unverified";
  message: string;
  details: Record<string, boolean | number | string>;
};

export function evaluateOperationalAlerts(
  status: OperationalStatus,
  thresholds: OperationalAlertThresholds,
  now = Date.now(),
): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];

  if (!status.database) {
    alerts.push({
      code: "database_unhealthy",
      message: "Schedules database operational status could not be collected",
      details: {},
    });
  }

  if (!status.redis) {
    alerts.push({
      code: "redis_unhealthy",
      message: "Schedules Redis health check failed",
      details: {},
    });
  }

  for (const queue of status.queues) {
    if (!queue.isHealthy) {
      alerts.push({
        code: "queue_unhealthy",
        message: "A BullMQ queue health check failed",
        details: { queue: queue.name },
      });
    }
    if (queue.waitingCount >= thresholds.queueWaiting) {
      alerts.push({
        code: "queue_waiting_threshold",
        message: "A BullMQ queue waiting count exceeded its threshold",
        details: {
          queue: queue.name,
          waitingCount: queue.waitingCount,
          threshold: thresholds.queueWaiting,
        },
      });
    }
    if (queue.failedCount >= thresholds.queueFailed) {
      alerts.push({
        code: "queue_failed_threshold",
        message: "A BullMQ queue failed count exceeded its threshold",
        details: {
          queue: queue.name,
          failedCount: queue.failedCount,
          threshold: thresholds.queueFailed,
        },
      });
    }
  }

  if (status.outbox) {
    if (status.outbox.pending >= thresholds.outboxPending) {
      alerts.push({
        code: "outbox_pending_threshold",
        message: "Transactional outbox pending count exceeded its threshold",
        details: {
          pending: status.outbox.pending,
          threshold: thresholds.outboxPending,
        },
      });
    }
    if (status.outbox.deadLetter >= thresholds.outboxDeadLetter) {
      alerts.push({
        code: "outbox_dead_letter_threshold",
        message:
          "Transactional outbox dead-letter count exceeded its threshold",
        details: {
          deadLetter: status.outbox.deadLetter,
          threshold: thresholds.outboxDeadLetter,
        },
      });
    }
  }

  if (status.backup) {
    const lastSucceededAt = status.backup.lastSucceededAt
      ? Date.parse(status.backup.lastSucceededAt)
      : Number.NaN;
    const lastFailedAt = status.backup.lastFailedAt
      ? Date.parse(status.backup.lastFailedAt)
      : Number.NaN;

    if (
      Number.isFinite(lastFailedAt) &&
      (!Number.isFinite(lastSucceededAt) || lastFailedAt > lastSucceededAt)
    ) {
      alerts.push({
        code: "backup_failed",
        message: "The most recent backup run failed after the last success",
        details: { lastFailedAt: status.backup.lastFailedAt ?? "" },
      });
    }
    if (thresholds.backupRequireSuccess && !Number.isFinite(lastSucceededAt)) {
      alerts.push({
        code: "backup_missing",
        message: "No successful backup has been recorded",
        details: {},
      });
    }
    if (
      thresholds.backupRequireRestoreVerification &&
      Number.isFinite(lastSucceededAt) &&
      !Number.isFinite(
        status.backup.lastSucceededRestoreTestedAt
          ? Date.parse(status.backup.lastSucceededRestoreTestedAt)
          : Number.NaN,
      )
    ) {
      alerts.push({
        code: "backup_restore_unverified",
        message:
          "The most recent successful backup has not been restore-tested",
        details: {
          lastSucceededAt: status.backup.lastSucceededAt ?? "",
        },
      });
    }
    if (
      thresholds.backupMaxAgeMs > 0 &&
      Number.isFinite(lastSucceededAt) &&
      now - lastSucceededAt > thresholds.backupMaxAgeMs
    ) {
      alerts.push({
        code: "backup_stale",
        message:
          "The last successful backup is older than its freshness threshold",
        details: {
          lastSucceededAt: status.backup.lastSucceededAt ?? "",
          ageMs: now - lastSucceededAt,
          threshold: thresholds.backupMaxAgeMs,
        },
      });
    }
  }

  return alerts;
}

export type OperationalMonitor = {
  check(): Promise<void>;
  stop(): void;
};

export function createOperationalMonitor(
  readStatus: () => Promise<OperationalStatus>,
  options: {
    thresholds: OperationalAlertThresholds;
    intervalMs: number;
    onAlert: (alert: OperationalAlert) => void;
    now?: () => number;
  },
): OperationalMonitor {
  const activeAlerts = new Set<string>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  const check = async (): Promise<void> => {
    if (stopped) return;

    let alerts: OperationalAlert[];
    try {
      alerts = evaluateOperationalAlerts(
        await readStatus(),
        options.thresholds,
        options.now?.() ?? Date.now(),
      );
    } catch {
      alerts = [
        {
          code: "operational_status_unavailable",
          message: "Unable to collect schedules operational status",
          details: {},
        },
      ];
    }

    const currentAlerts = new Set(
      alerts.map(
        (alert) => `${alert.code}:${String(alert.details.queue ?? "")}`,
      ),
    );
    for (const key of [...activeAlerts]) {
      if (!currentAlerts.has(key)) activeAlerts.delete(key);
    }
    for (const alert of alerts) {
      const key = `${alert.code}:${String(alert.details.queue ?? "")}`;
      if (activeAlerts.has(key)) continue;
      activeAlerts.add(key);
      options.onAlert(alert);
    }
  };

  timer = setInterval(() => void check(), Math.max(10_000, options.intervalMs));
  timer.unref?.();

  return {
    check,
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}

export function createHealthServer(
  workerManager: WorkerManager,
  isShuttingDown: () => boolean,
  dependencies: HealthDependencies = {},
) {
  const app = new Hono();
  const startTime = Date.now();
  const queueChecker = new QueueHealthChecker();
  const isRedisReady = dependencies.isRedisReady ?? (() => pingRedis(redis));
  const inspectQueue =
    dependencies.inspectQueue ??
    ((queueName) => queueChecker.inspectQueue(queueName));

  const readOperationalStatus = async (): Promise<OperationalStatus> => {
    const redisReady = await isRedisReady();
    const [backupQueueStatus, notificationQueueStatus] = await Promise.all([
      inspectQueue(BACKUP_RUN_QUEUE),
      inspectQueue(NOTIFICATION_DELIVERY_QUEUE),
    ]);
    let outbox: OutboxOperationalSummary | null = null;
    let databaseReady = true;
    if (dependencies.getOutboxSummary) {
      try {
        outbox = await dependencies.getOutboxSummary();
      } catch {
        // Keep operational signals useful when the database is unavailable.
        databaseReady = false;
      }
    }

    let backup: BackupOperationalSummary | null = null;
    if (dependencies.getBackupSummary) {
      try {
        backup = await dependencies.getBackupSummary();
      } catch {
        // Keep operational signals useful when the database is unavailable.
        databaseReady = false;
      }
    }

    return {
      database: databaseReady,
      redis: redisReady,
      outbox,
      backup,
      queues: [backupQueueStatus, notificationQueueStatus],
    };
  };

  app.get("/health/live", (c: Context) => {
    if (isShuttingDown()) {
      return c.json({ status: "shutting_down" }, 503);
    }
    return c.json({ status: "ok" });
  });

  app.get("/health/ready", async (c: Context) => {
    if (isShuttingDown()) {
      return c.json({ status: "shutting_down" }, 503);
    }

    const workersReady = workerManager.isReady();
    const redisReady = await isRedisReady();
    if (!workersReady || !redisReady) {
      return c.json(
        { status: "not_ready", workersReady, redis: redisReady },
        503,
      );
    }

    return c.json({ status: "ok", workersReady: true, redis: true });
  });

  app.get("/status", async (c: Context) => {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    const {
      redis: redisReady,
      queues,
      outbox,
      backup,
    } = await readOperationalStatus();

    return c.json({
      service: "upstand-schedules",
      status: isShuttingDown() ? "shutting_down" : "running",
      uptimeSeconds,
      workersReady: workerManager.isReady(),
      redis: redisReady,
      outbox,
      backup,
      queues,
    });
  });

  app.get("/metrics", async (c: Context) => {
    try {
      const metrics = renderOperationalMetrics(await readOperationalStatus(), {
        workersReady: workerManager.isReady(),
        uptimeSeconds: (Date.now() - startTime) / 1000,
      });
      return c.text(metrics, 200, { "content-type": PROMETHEUS_CONTENT_TYPE });
    } catch {
      const metrics =
        "# HELP upstand_schedules_collection_success Whether the schedules operational status was collected successfully.\n# TYPE upstand_schedules_collection_success gauge\nupstand_schedules_collection_success 0\n";
      return c.text(metrics, 503, { "content-type": PROMETHEUS_CONTENT_TYPE });
    }
  });

  return Object.assign(app, {
    close: () => queueChecker.close(),
    readOperationalStatus,
  });
}
