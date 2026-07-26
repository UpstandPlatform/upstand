import { closeDb } from "@upstand/db";
import { closeRedis, redis } from "@upstand/redis";
import { type DrainContext, initLogger, log } from "evlog";
import { createFsDrain } from "evlog/fs";
import { createOTLPDrain } from "evlog/otlp";
import { createHealthServer } from "./health";
import { SchedulerManager } from "./scheduler";
import { WorkerManager } from "./workers";

const fileDrain = createFsDrain({ maxFiles: 7 });
const otlpEndpoint =
  process.env.OTLP_ENDPOINT?.trim() ||
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
const otlpDrain = otlpEndpoint
  ? createOTLPDrain({
      endpoint: otlpEndpoint,
      serviceName: "upstand-schedules",
    })
  : undefined;

const drain = async (context: DrainContext | DrainContext[]) => {
  await Promise.allSettled([
    fileDrain(context),
    ...(otlpDrain ? [otlpDrain(context)] : []),
  ]);
};

initLogger({
  env: { service: "upstand-schedules" },
  drain,
});

log.info({ message: "Initializing Upstand Schedules Service 🚀" });

let shuttingDown = false;

const schedulerManager = new SchedulerManager();
const workerManager = new WorkerManager();

await schedulerManager.start();
await workerManager.start();

const healthApp = createHealthServer(workerManager, () => shuttingDown);

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
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

  await closeRedis(redis);
  await closeDb();
  log.info({
    message: "Graceful shutdown of Schedules Service completed",
    signal,
  });
  process.exit(result === "timeout" ? 1 : 0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

const port = Number(process.env.SCHEDULES_PORT || process.env.PORT || 3002);

export default {
  port,
  fetch: healthApp.fetch,
};
