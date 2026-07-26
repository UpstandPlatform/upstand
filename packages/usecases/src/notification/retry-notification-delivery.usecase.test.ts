import { expect, test } from "bun:test";
import type { IUnitOfWork, NotificationDelivery } from "@upstand/domain";
import { RetryNotificationDeliveryUseCase } from "./retry-notification-delivery.usecase";

function delivery(
  status: NotificationDelivery["status"],
): NotificationDelivery {
  const now = new Date();
  return {
    id: "delivery-1",
    channelId: "channel-1",
    organizationId: "org-1",
    event: "deployment_failed",
    idempotencyKey: "key-1",
    title: "Deployment failed",
    message: "The deployment failed",
    metadata: null,
    status,
    attempts: 3,
    error: "provider unavailable",
    deliveredAt: null,
    processingStartedAt: null,
    lastAttemptAt: now,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

test("requeues a failed notification and resets delivery attempts", async () => {
  const updates: Array<Record<string, unknown>> = [];
  const current = delivery("dead_letter");
  const outboxMessages: unknown[] = [];
  const uow = {
    notificationDeliveryRepository: {
      findById: async () => current,
    },
    transaction: async (work: (tx: never) => Promise<unknown>) =>
      work({
        notificationDeliveryRepository: {
          updateById: async (_id: string, patch: Record<string, unknown>) => {
            updates.push(patch);
            return { ...current, ...patch };
          },
        },
        outboxRepository: {
          create: async (message: unknown) => {
            outboxMessages.push(message);
            return message;
          },
        },
      } as never),
  };
  const useCase = new RetryNotificationDeliveryUseCase(
    uow as unknown as IUnitOfWork,
  );

  const result = await useCase.execute(current.id);

  expect(result.status).toBe("queued");
  expect(updates[0]).toMatchObject({
    status: "queued",
    attempts: 0,
    error: null,
  });
  expect(outboxMessages).toHaveLength(1);
  expect(outboxMessages[0]).toMatchObject({
    type: "notification.deliver",
    payload: { deliveryId: current.id },
  });
});

test("does not retry a delivered notification", async () => {
  const current = delivery("delivered");
  const uow = {
    notificationDeliveryRepository: {
      findById: async () => current,
      updateById: async () => current,
    },
  };
  const useCase = new RetryNotificationDeliveryUseCase(
    uow as unknown as IUnitOfWork,
  );

  await expect(useCase.execute(current.id)).rejects.toThrow(
    "Only failed notification deliveries can be retried",
  );
});
