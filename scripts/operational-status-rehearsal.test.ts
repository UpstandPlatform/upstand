import { describe, expect, test } from "bun:test";
import {
  evaluateOperationalStatus,
  type OperationalStatusSnapshot,
  parseOperationalThresholds,
  runOperationalStatusRehearsal,
} from "./operational-status-rehearsal";

const healthySnapshot = (): OperationalStatusSnapshot => ({
  controlPlane: { status: 200, body: { status: "ready" } },
  schedulesReady: { status: 200, body: { status: "ok" } },
  schedulesStatus: {
    status: 200,
    body: {
      status: "running",
      redis: true,
      workersReady: true,
      queues: [
        {
          name: "backups-queue",
          waitingCount: 0,
          failedCount: 0,
          delayedCount: 0,
          isHealthy: true,
        },
      ],
      outbox: { pending: 0, publishing: 0, deadLetter: 0 },
      backup: { lastSucceededAt: null, lastFailedAt: null },
    },
  },
});

describe("operational status rehearsal", () => {
  test("accepts healthy readiness, queue, outbox, and backup summaries", () => {
    const result = evaluateOperationalStatus(
      healthySnapshot(),
      parseOperationalThresholds({}),
    );

    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test("fails when queue and outbox thresholds are exceeded", () => {
    const snapshot = healthySnapshot();
    const status = snapshot.schedulesStatus.body as Record<string, unknown>;
    status.queues = [
      {
        name: "backups-queue",
        waitingCount: 11,
        failedCount: 2,
        delayedCount: 0,
        isHealthy: true,
      },
    ];
    status.outbox = { pending: 11, publishing: 2, deadLetter: 1 };

    const result = evaluateOperationalStatus(
      snapshot,
      parseOperationalThresholds({
        OPERATIONAL_STATUS_MAX_WAITING_COUNT: "10",
        OPERATIONAL_STATUS_MAX_FAILED_COUNT: "1",
        OPERATIONAL_STATUS_MAX_OUTBOX_PENDING_COUNT: "10",
        OPERATIONAL_STATUS_MAX_OUTBOX_PUBLISHING_COUNT: "1",
        OPERATIONAL_STATUS_MAX_DEAD_LETTER_COUNT: "0",
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(5);
  });

  test("fails when the most recent backup failed or is stale", () => {
    const snapshot = healthySnapshot();
    const status = snapshot.schedulesStatus.body as Record<string, unknown>;
    status.backup = {
      lastSucceededAt: "2026-08-02T07:00:00.000Z",
      lastFailedAt: "2026-08-02T07:30:00.000Z",
    };

    const result = evaluateOperationalStatus(
      snapshot,
      parseOperationalThresholds({
        OPERATIONAL_STATUS_MAX_BACKUP_AGE_SECONDS: "60",
        OPERATIONAL_STATUS_REQUIRE_BACKUP_SUCCESS: "true",
      }),
      Date.parse("2026-08-02T08:00:00.000Z"),
    );

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual([
      "the most recent backup run failed",
      "last successful backup is older than 60 seconds",
    ]);
  });

  test("requires restore verification when the recovery gate is enabled", () => {
    const snapshot = healthySnapshot();
    const status = snapshot.schedulesStatus.body as Record<string, unknown>;
    status.backup = {
      lastSucceededAt: "2026-08-02T07:00:00.000Z",
      lastFailedAt: null,
      lastSucceededRestoreTestedAt: "2026-08-02T06:00:00.000Z",
    };

    const result = evaluateOperationalStatus(
      snapshot,
      parseOperationalThresholds({
        OPERATIONAL_STATUS_REQUIRE_BACKUP_SUCCESS: "true",
        OPERATIONAL_STATUS_REQUIRE_BACKUP_RESTORE_VERIFICATION: "true",
      }),
      Date.parse("2026-08-02T08:00:00.000Z"),
    );

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual([
      "the most recent successful backup has no subsequent restore verification",
    ]);
  });

  test("fetches the private readiness and status endpoints", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const path = url.pathname;
        if (path.endsWith("/health/ready")) {
          return Response.json({
            status: path.startsWith("/schedules/") ? "ok" : "ready",
          });
        }
        if (path.endsWith("/status")) {
          return Response.json({
            status: "running",
            redis: true,
            workersReady: true,
            queues: [
              {
                name: "backups-queue",
                waitingCount: 0,
                failedCount: 0,
                delayedCount: 0,
                isHealthy: true,
              },
            ],
            outbox: { pending: 0, publishing: 0, deadLetter: 0 },
            backup: { lastSucceededAt: null, lastFailedAt: null },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const result = await runOperationalStatusRehearsal(
        `http://127.0.0.1:${server.port}/control`,
        `http://127.0.0.1:${server.port}/schedules`,
        parseOperationalThresholds({}),
      );
      expect(result.passed).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});
