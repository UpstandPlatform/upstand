import { expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { PublishNotificationUseCase } from "./publish-notification.usecase";

function channel(id: string) {
  return {
    id,
    organizationId: "org-1",
  } as never;
}

test("routes Docker cleanup failures to both cleanup channel selections", async () => {
  const eventLookups: string[] = [];
  const createdDeliveries: Array<Record<string, unknown>> = [];
  const outboxMessages: Array<Record<string, unknown>> = [];

  const uow = {
    notificationChannelRepository: {
      findByEvent: async (event: string, organizationId?: string) => {
        eventLookups.push(`${event}:${organizationId}`);
        return event === "docker_cleanup_failed"
          ? [channel("failure-channel"), channel("shared-channel")]
          : [channel("shared-channel"), channel("success-channel")];
      },
    },
    transaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        notificationDeliveryRepository: {
          createMany: async (deliveries: Array<Record<string, unknown>>) => {
            createdDeliveries.push(...deliveries);
            return deliveries;
          },
        },
        outboxRepository: {
          createMany: async (messages: Array<Record<string, unknown>>) => {
            outboxMessages.push(...messages);
            return messages;
          },
        },
      }),
  } as unknown as IUnitOfWork;

  const created = await new PublishNotificationUseCase(uow).execute({
    event: "docker_cleanup_failed",
    organizationId: "org-1",
    title: "Docker cleanup failed",
    message: "Docker is unavailable",
  });

  expect(eventLookups).toEqual([
    "docker_cleanup_failed:org-1",
    "docker_cleanup_completed:org-1",
  ]);
  expect(created).toBe(3);
  expect(createdDeliveries).toHaveLength(3);
  expect(
    new Set(createdDeliveries.map((delivery) => delivery.channelId)),
  ).toEqual(new Set(["failure-channel", "shared-channel", "success-channel"]));
  expect(outboxMessages).toHaveLength(3);
});
