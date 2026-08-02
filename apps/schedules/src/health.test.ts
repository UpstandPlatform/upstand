import { describe, expect, test } from "bun:test";
import {
  BACKUP_RUN_QUEUE,
  NOTIFICATION_DELIVERY_QUEUE,
} from "@upstand/usecases";
import {
  createHealthServer,
  createOperationalMonitor,
  evaluateOperationalAlerts,
  renderOperationalMetrics,
} from "./health";

const readyWorkers = { isReady: () => true } as never;

describe("schedules health endpoints", () => {
  test("reports Redis as a readiness dependency", async () => {
    const app = createHealthServer(readyWorkers, () => false, {
      isRedisReady: async () => false,
    });

    const response = await app.request("/health/ready");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "not_ready",
      workersReady: true,
      redis: false,
    });
  });

  test("reports the actual BullMQ queue names", async () => {
    const inspected: string[] = [];
    const app = createHealthServer(readyWorkers, () => false, {
      isRedisReady: async () => true,
      getOutboxSummary: async () => ({
        pending: 2,
        publishing: 1,
        published: 10,
        deadLetter: 3,
      }),
      getBackupSummary: async () => ({
        lastSucceededAt: "2026-08-01T12:00:00.000Z",
        lastFailedAt: null,
      }),
      inspectQueue: async (queueName) => {
        inspected.push(queueName);
        return {
          name: queueName,
          activeCount: 0,
          waitingCount: 0,
          delayedCount: 0,
          failedCount: 0,
          completedCount: 0,
          isHealthy: true,
        };
      },
    });

    const response = await app.request("/status");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      outbox: unknown;
      backup: unknown;
    };
    expect(body.outbox).toEqual({
      pending: 2,
      publishing: 1,
      published: 10,
      deadLetter: 3,
    });
    expect(body.backup).toEqual({
      lastSucceededAt: "2026-08-01T12:00:00.000Z",
      lastFailedAt: null,
    });
    expect(inspected).toEqual([BACKUP_RUN_QUEUE, NOTIFICATION_DELIVERY_QUEUE]);
  });

  test("exposes bounded Prometheus metrics for operational status", async () => {
    const app = createHealthServer(readyWorkers, () => false, {
      isRedisReady: async () => true,
      getOutboxSummary: async () => ({
        pending: 2,
        publishing: 1,
        published: 10,
        deadLetter: 3,
      }),
      getBackupSummary: async () => ({
        lastSucceededAt: "2026-08-02T11:00:00.000Z",
        lastFailedAt: null,
      }),
      inspectQueue: async (queueName) => ({
        name: queueName,
        activeCount: 0,
        waitingCount: 4,
        delayedCount: 0,
        failedCount: 1,
        completedCount: 0,
        isHealthy: true,
      }),
    });

    const response = await app.request("/metrics");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body).toContain("upstand_schedules_database_ready 1");
    expect(body).toContain(
      `upstand_schedules_queue_waiting{queue="${BACKUP_RUN_QUEUE}"} 4`,
    );
    expect(body).toContain("upstand_schedules_outbox_dead_letter 3");
    expect(body).toContain("upstand_schedules_backup_success_present 1");
    expect(body).not.toContain("DATABASE_URL");
  });

  test("renders an explicit scrape failure when status collection fails", async () => {
    const app = createHealthServer(readyWorkers, () => false, {
      isRedisReady: async () => {
        throw new Error("redis unavailable");
      },
    });

    const response = await app.request("/metrics");

    expect(response.status).toBe(503);
    expect(await response.text()).toContain(
      "upstand_schedules_collection_success 0",
    );
  });
});

describe("schedules operational alerts", () => {
  const thresholds = {
    queueWaiting: 10,
    queueFailed: 1,
    outboxPending: 10,
    outboxDeadLetter: 1,
    backupMaxAgeMs: 60_000,
    backupRequireSuccess: false,
  };

  test("identifies queue, outbox, and stale-backup conditions", () => {
    const now = Date.parse("2026-08-02T12:00:00.000Z");
    const alerts = evaluateOperationalAlerts(
      {
        database: true,
        redis: false,
        queues: [
          {
            name: "backup-runs",
            activeCount: 0,
            waitingCount: 10,
            delayedCount: 0,
            failedCount: 1,
            completedCount: 0,
            isHealthy: true,
          },
          {
            name: "notifications",
            activeCount: 0,
            waitingCount: 0,
            delayedCount: 0,
            failedCount: 0,
            completedCount: 0,
            isHealthy: false,
          },
        ],
        outbox: { pending: 10, publishing: 0, published: 0, deadLetter: 1 },
        backup: {
          lastSucceededAt: "2026-08-02T11:50:00.000Z",
          lastFailedAt: "2026-08-02T11:59:00.000Z",
        },
      },
      thresholds,
      now,
    );

    expect(alerts.map((alert) => alert.code)).toEqual([
      "redis_unhealthy",
      "queue_waiting_threshold",
      "queue_failed_threshold",
      "queue_unhealthy",
      "outbox_pending_threshold",
      "outbox_dead_letter_threshold",
      "backup_failed",
      "backup_stale",
    ]);
  });

  test("deduplicates repeated alerts until the condition recovers", async () => {
    const emitted: string[] = [];
    const monitor = createOperationalMonitor(
      async () => ({
        database: true,
        redis: true,
        queues: [
          {
            name: "backup-runs",
            activeCount: 0,
            waitingCount: 20,
            delayedCount: 0,
            failedCount: 0,
            completedCount: 0,
            isHealthy: true,
          },
        ],
        outbox: null,
        backup: null,
      }),
      {
        thresholds,
        intervalMs: 10_000,
        onAlert: (alert) => emitted.push(alert.code),
      },
    );

    await monitor.check();
    await monitor.check();
    monitor.stop();

    expect(emitted).toEqual(["queue_waiting_threshold"]);
  });

  test("alerts when persistence is unavailable or backup coverage is required", () => {
    const alerts = evaluateOperationalAlerts(
      {
        database: false,
        redis: true,
        queues: [],
        outbox: null,
        backup: { lastSucceededAt: null, lastFailedAt: null },
      },
      { ...thresholds, backupRequireSuccess: true },
    );

    expect(alerts.map((alert) => alert.code)).toEqual([
      "database_unhealthy",
      "backup_missing",
    ]);
  });
});

describe("Prometheus operational metrics", () => {
  test("escapes queue labels and reports absent backup state safely", () => {
    const metrics = renderOperationalMetrics(
      {
        database: false,
        redis: true,
        queues: [
          {
            name: 'queue"\n',
            activeCount: 0,
            waitingCount: 0,
            delayedCount: 0,
            failedCount: 0,
            completedCount: 0,
            isHealthy: false,
          },
        ],
        outbox: null,
        backup: null,
      },
      { workersReady: false, uptimeSeconds: 1.5, now: Date.now() },
    );

    expect(metrics).toContain('queue="queue\\"\\n"');
    expect(metrics).toContain("upstand_schedules_database_ready 0");
    expect(metrics).toContain("upstand_schedules_backup_success_present 0");
    expect(metrics).toContain("upstand_schedules_backup_age_seconds 0");
  });
});
