import { closeRedis, createRedis, type Redis } from "@upstand/redis";
import type { Job, Worker } from "bullmq";
import { log } from "evlog";

export interface ManagedQueueWorkerOptions {
  loggerName: string;
  failedMessage: string;
  connectionErrorMessage: string;
  createWorker: (connection: Redis) => Worker;
  getFailedJobContext?: (job: Job | undefined) => Record<string, unknown>;
}

export class ManagedQueueWorker {
  private worker: Worker | null = null;
  private workerRedis: Redis | null = null;

  constructor(private readonly options: ManagedQueueWorkerOptions) {}

  async start(): Promise<void> {
    if (this.worker) return;

    const connection = createRedis({
      maxRetriesPerRequest: null,
      loggerName: this.options.loggerName,
    });
    this.workerRedis = connection;

    try {
      this.worker = this.options.createWorker(connection);
      this.worker.on("failed", (job, error) => {
        log.error({
          message: this.options.failedMessage,
          ...this.options.getFailedJobContext?.(job),
          jobId: job?.id,
          attemptsMade: job?.attemptsMade,
          err: error,
        });
      });
      this.worker.on("error", (error) => {
        log.error({
          message: this.options.connectionErrorMessage,
          err: error,
        });
      });
      await this.worker.waitUntilReady();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  isReady(): boolean {
    return Boolean(this.worker?.isRunning());
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.workerRedis) {
      await closeRedis(this.workerRedis);
      this.workerRedis = null;
    }
  }
}
