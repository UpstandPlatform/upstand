import { closeRedis, createRedis, type Redis } from "@upstand/redis";
import { Queue } from "bullmq";

export interface QueueHealthStatus {
  name: string;
  activeCount: number;
  waitingCount: number;
  delayedCount: number;
  failedCount: number;
  completedCount: number;
  isHealthy: boolean;
}

export class QueueHealthChecker {
  private redisConnection: Redis | null = null;

  private getRedisConnection(): Redis {
    if (!this.redisConnection) {
      this.redisConnection = createRedis({
        loggerName: "schedules-queue-checker",
        redisOptions: {
          commandTimeout: 1_000,
          connectTimeout: 1_000,
        },
      });
    }
    return this.redisConnection;
  }

  async close(): Promise<void> {
    const connection = this.redisConnection;
    this.redisConnection = null;
    if (connection) await closeRedis(connection);
  }

  async inspectQueue(queueName: string): Promise<QueueHealthStatus> {
    const connection = this.getRedisConnection();
    const queue = new Queue(queueName, { connection: connection as never });

    try {
      const [active, waiting, delayed, failed, completed] = await Promise.all([
        queue.getActiveCount(),
        queue.getWaitingCount(),
        queue.getDelayedCount(),
        queue.getFailedCount(),
        queue.getCompletedCount(),
      ]);

      return {
        name: queueName,
        activeCount: active,
        waitingCount: waiting,
        delayedCount: delayed,
        failedCount: failed,
        completedCount: completed,
        isHealthy: true,
      };
    } catch {
      return {
        name: queueName,
        activeCount: 0,
        waitingCount: 0,
        delayedCount: 0,
        failedCount: 0,
        completedCount: 0,
        isHealthy: false,
      };
    } finally {
      await queue.close();
    }
  }
}
