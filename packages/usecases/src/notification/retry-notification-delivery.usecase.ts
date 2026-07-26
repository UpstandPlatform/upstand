import type { IUnitOfWork } from "@upstand/domain";
import {
  type NotificationDeliveryOutboxPayload,
  OUTBOX_COMMAND_TYPES,
} from "../outbox/outbox-commands";

export class RetryNotificationDeliveryUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(deliveryId: string) {
    const delivery =
      await this.uow.notificationDeliveryRepository.findById(deliveryId);
    if (!delivery) throw new Error("Notification delivery not found");
    if (delivery.status !== "failed" && delivery.status !== "dead_letter") {
      throw new Error("Only failed notification deliveries can be retried");
    }

    return this.uow.transaction(async (tx) => {
      const queued = tx.notificationDeliveryRepository.requeueIfRetryable
        ? await tx.notificationDeliveryRepository.requeueIfRetryable(
            delivery.id,
            delivery.updatedAt,
          )
        : await tx.notificationDeliveryRepository.updateById(delivery.id, {
            status: "queued",
            attempts: 0,
            error: null,
            deliveredAt: null,
            processingStartedAt: null,
            lastAttemptAt: null,
            nextAttemptAt: null,
          });
      if (!queued) throw new Error("Notification delivery could not be queued");

      const payload: NotificationDeliveryOutboxPayload = {
        deliveryId: delivery.id,
      };
      await tx.outboxRepository.create({
        type: OUTBOX_COMMAND_TYPES.notificationDelivery,
        payload,
        aggregateType: "notification_delivery",
        aggregateId: delivery.id,
        organizationId: delivery.organizationId,
        idempotencyKey: `notification-delivery:${delivery.id}:retry:${delivery.updatedAt.toISOString()}`,
      });

      return queued;
    });
  }
}
