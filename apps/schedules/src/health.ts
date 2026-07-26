import { type Context, Hono } from "hono";
import { QueueHealthChecker } from "./queues";
import type { WorkerManager } from "./workers";

export function createHealthServer(
  workerManager: WorkerManager,
  isShuttingDown: () => boolean,
) {
  const app = new Hono();
  const startTime = Date.now();
  const queueChecker = new QueueHealthChecker();

  app.get("/health/live", (c: Context) => {
    if (isShuttingDown()) {
      return c.json({ status: "shutting_down" }, 503);
    }
    return c.json({ status: "ok" });
  });

  app.get("/health/ready", (c: Context) => {
    if (isShuttingDown()) {
      return c.json({ status: "shutting_down" }, 503);
    }

    const workersReady = workerManager.isReady();
    if (!workersReady) {
      return c.json({ status: "not_ready", workersReady: false }, 503);
    }

    return c.json({ status: "ok", workersReady: true });
  });

  app.get("/status", async (c: Context) => {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    const backupQueueStatus =
      await queueChecker.inspectQueue("upstand-backup-run");
    const notificationQueueStatus = await queueChecker.inspectQueue(
      "upstand-notification-delivery",
    );

    return c.json({
      service: "upstand-schedules",
      status: isShuttingDown() ? "shutting_down" : "running",
      uptimeSeconds,
      workersReady: workerManager.isReady(),
      queues: [backupQueueStatus, notificationQueueStatus],
    });
  });

  return app;
}
