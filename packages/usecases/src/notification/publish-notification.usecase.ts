import { randomUUID } from "node:crypto";
import type { IUnitOfWork, NotificationEventType } from "@upstand/domain";
import {
  type NotificationDeliveryOutboxPayload,
  OUTBOX_COMMAND_TYPES,
} from "../outbox/outbox-commands";

export interface PublishNotificationInput {
  event: NotificationEventType;
  title: string;
  message: string;
  organizationId?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  correlationId?: string;
}

export const NOTIFICATION_DELIVERY_QUEUE = "notification-delivery";

export class PublishNotificationUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: PublishNotificationInput): Promise<number> {
    const channelEvents: NotificationEventType[] =
      input.event === "docker_cleanup_failed"
        ? ["docker_cleanup_failed", "docker_cleanup_completed"]
        : [input.event];
    const channelResults = await Promise.all(
      channelEvents.map((event) =>
        this.uow.notificationChannelRepository.findByEvent(
          event,
          input.organizationId,
        ),
      ),
    );
    const channels = [
      ...new Map(
        channelResults.flat().map((channel) => [channel.id, channel]),
      ).values(),
    ];
    if (channels.length === 0) return 0;

    const deliveries = await this.uow.transaction(async (tx) => {
      const created = await tx.notificationDeliveryRepository.createMany(
        channels.map((channel) => ({
          id: randomUUID(),
          channelId: channel.id,
          organizationId: channel.organizationId,
          event: input.event,
          title: input.title,
          message: input.message,
          idempotencyKey: `${input.idempotencyKey ?? randomUUID()}:${channel.id}`,
          metadata: input.metadata ?? null,
          status: "queued",
        })),
      );

      await tx.outboxRepository.createMany(
        created.map((delivery) => {
          const payload: NotificationDeliveryOutboxPayload = {
            deliveryId: delivery.id,
            correlationId: input.correlationId,
          };
          return {
            id: delivery.id,
            type: OUTBOX_COMMAND_TYPES.notificationDelivery,
            payload,
            aggregateType: "notification_delivery",
            aggregateId: delivery.id,
            organizationId: delivery.organizationId,
            idempotencyKey: `notification-delivery:${delivery.id}`,
          };
        }),
      );

      return created;
    });

    return deliveries.length;
  }
}

export type NotificationPublisher = Pick<PublishNotificationUseCase, "execute">;
