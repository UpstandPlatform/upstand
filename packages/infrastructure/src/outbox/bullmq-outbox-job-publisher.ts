import type { OutboxMessage } from "@upstand/domain";
import { closeRedis, createRedis, type Redis } from "@upstand/redis";
import {
  BACKUP_RUN_QUEUE,
  getDeploymentQueueName,
  NOTIFICATION_DELIVERY_QUEUE,
  OUTBOX_COMMAND_TYPES,
  type OutboxJobPublisher,
  WORKLOAD_MIGRATION_QUEUE,
} from "@upstand/usecases";
import { Queue } from "bullmq";
import { z } from "zod";

const deploymentPayloadSchema = z.object({
  correlationId: z.string().min(1).max(128).optional(),
  resourceId: z.string().min(1),
  deploymentId: z.string().min(1),
  serverId: z.string().min(1),
  previewDeploymentId: z.string().min(1).optional(),
  sourceRevision: z.string().min(1).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  retryBaseSeconds: z.number().int().min(1).max(300).optional(),
  retryMaxSeconds: z.number().int().min(1).max(3600).optional(),
});

const backupPayloadSchema = z.object({
  correlationId: z.string().min(1).max(128).optional(),
  runId: z.string().min(1),
});

const notificationPayloadSchema = z.object({
  correlationId: z.string().min(1).max(128).optional(),
  deliveryId: z.string().min(1),
});

const migrationPayloadSchema = z.object({
  correlationId: z.string().min(1).max(128).optional(),
  migrationId: z.string().min(1),
  deploymentId: z.string().min(1),
  resourceId: z.string().min(1),
  sourceServerId: z.string().min(1),
  targetServerId: z.string().min(1),
});

type QueueJobData = Record<string, unknown>;

export class BullMqOutboxJobPublisher implements OutboxJobPublisher {
  private readonly connection: Redis;
  private readonly queues = new Map<string, Queue<QueueJobData>>();

  constructor() {
    this.connection = createRedis({
      maxRetriesPerRequest: null,
      loggerName: "outbox-publisher",
    });
  }

  async publish(message: OutboxMessage): Promise<void> {
    switch (message.type) {
      case OUTBOX_COMMAND_TYPES.deploy: {
        const payload = deploymentPayloadSchema.parse(message.payload);
        // A queued deployment can be cancelled after its DB row is created but
        // before the outbox publisher hands it to BullMQ. Respect that marker
        // so cancellation cannot be undone by a late publish.
        if (
          await this.connection.get(
            `upstand:deployment:cancel:${payload.deploymentId}`,
          )
        ) {
          return;
        }
        await this.queue(getDeploymentQueueName(payload.serverId)).add(
          "deploy",
          payload,
          {
            jobId: message.id,
            attempts: payload.maxAttempts ?? 1,
            backoff: {
              type: "capped-exponential",
              delay: 0,
            },
            removeOnComplete: 1_000,
            removeOnFail: 1_000,
          },
        );
        return;
      }
      case OUTBOX_COMMAND_TYPES.backupRun: {
        const payload = backupPayloadSchema.parse(message.payload);
        await this.queue(BACKUP_RUN_QUEUE).add("run", payload, {
          jobId: message.id,
          // A worker can die after persisting `running` but before BullMQ
          // redelivers the job. Keep retrying long enough for the database
          // execution lease to become reclaimable instead of acknowledging a
          // still-running record as if it were complete.
          attempts: 8,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: 1_000,
          removeOnFail: 1_000,
        });
        return;
      }
      case OUTBOX_COMMAND_TYPES.notificationDelivery: {
        const payload = notificationPayloadSchema.parse(message.payload);
        await this.queue(NOTIFICATION_DELIVERY_QUEUE).add("deliver", payload, {
          jobId: message.id,
          attempts: 3,
          backoff: { type: "exponential", delay: 1_000 },
          removeOnComplete: 100,
          removeOnFail: 1_000,
        });
        return;
      }
      case OUTBOX_COMMAND_TYPES.migrate: {
        const payload = migrationPayloadSchema.parse(message.payload);
        await this.queue(WORKLOAD_MIGRATION_QUEUE).add("migrate", payload, {
          jobId: message.id,
          attempts: 8,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: 1_000,
          removeOnFail: 1_000,
        });
        return;
      }
      default:
        throw new Error(`Unsupported outbox message type: ${message.type}`);
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(
      [...this.queues.values()].map((queue) => queue.close()),
    );
    this.queues.clear();
    await closeRedis(this.connection);
  }

  private queue(name: string): Queue<QueueJobData> {
    const existing = this.queues.get(name);
    if (existing) return existing;

    const queue = new Queue<QueueJobData>(name, {
      connection: this.connection as never,
    });
    this.queues.set(name, queue);
    return queue;
  }
}
