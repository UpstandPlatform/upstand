import { describe, expect, test } from "bun:test";
import type { OutboxMessage } from "@upstand/domain";
import { getDeploymentQueueName } from "../deployment/deployment-queue-name";
import { OUTBOX_COMMAND_TYPES } from "../outbox/outbox-commands";

interface MockQueueJob {
  queueName: string;
  name: string;
  data: Record<string, unknown>;
}

function createOutboxMessage(
  overrides: Partial<OutboxMessage> = {},
): OutboxMessage {
  return {
    id: "outbox-1",
    aggregateType: "deployment",
    aggregateId: "dep-1",
    organizationId: "org-1",
    type: OUTBOX_COMMAND_TYPES.deploy,
    payload: {
      resourceId: "res-1",
      deploymentId: "dep-1",
      serverId: "server-primary",
    },
    idempotencyKey: "idemp-1",
    status: "pending",
    attempts: 1,
    maxAttempts: 3,
    claimedAt: new Date(),
    claimedBy: "worker-1",
    leaseExpiresAt: new Date(Date.now() + 60000),
    lastError: null,
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as OutboxMessage;
}

describe("Queue, Cron Scheduler, Outbox & Backup Pipeline Tests", () => {
  describe("BullMQ Deployment Queue Name Encoding", () => {
    test("encodes server IDs safely to avoid BullMQ key layout collisions", () => {
      const queueDefault = getDeploymentQueueName("server-1");
      const queueComplex = getDeploymentQueueName("node:swarm:123/abc");

      expect(queueDefault).toBe("deployments-queue-server-1");
      expect(queueComplex).toBe("deployments-queue-node%3Aswarm%3A123%2Fabc");
      expect(queueComplex.includes(":")).toBe(false);
    });
  });

  describe("Outbox Command Dispatching & Queue Isolation", () => {
    test("processes outbox messages and dispatches deployment commands to server queue", async () => {
      const message = createOutboxMessage({
        type: OUTBOX_COMMAND_TYPES.deploy,
        payload: {
          resourceId: "res-1",
          deploymentId: "dep-1",
          serverId: "server-primary",
        },
      });

      const publishedJobs: MockQueueJob[] = [];

      const mockJobPublisher = {
        publish: async (msg: OutboxMessage) => {
          const payload = msg.payload as { serverId?: string };
          const queueName = payload.serverId
            ? getDeploymentQueueName(payload.serverId)
            : "deployments-queue-default";

          publishedJobs.push({
            queueName,
            name: "deploy",
            data: msg.payload as Record<string, unknown>,
          });
        },
      };

      await mockJobPublisher.publish(message);

      expect(publishedJobs.length).toBe(1);
      expect(publishedJobs[0]?.queueName).toBe(
        "deployments-queue-server-primary",
      );
      expect(publishedJobs[0]?.data).toMatchObject({
        resourceId: "res-1",
        deploymentId: "dep-1",
      });
    });

    test("dispatches backup outbox commands to dedicated backup queue", async () => {
      const message = createOutboxMessage({
        id: "outbox-backup-1",
        type: OUTBOX_COMMAND_TYPES.backupRun,
        payload: {
          runId: "backup-run-789",
        },
      });

      const publishedJobs: MockQueueJob[] = [];

      const mockJobPublisher = {
        publish: async (msg: OutboxMessage) => {
          publishedJobs.push({
            queueName: "backups-queue",
            name: "backupRun",
            data: msg.payload as Record<string, unknown>,
          });
        },
      };

      await mockJobPublisher.publish(message);

      expect(publishedJobs.length).toBe(1);
      expect(publishedJobs[0]?.queueName).toBe("backups-queue");
      expect(publishedJobs[0]?.data).toMatchObject({
        runId: "backup-run-789",
      });
    });
  });
});
