import type { IUnitOfWork } from "@upstand/domain";
import { decryptNotificationConfiguration } from "./notification-configuration";
import type { NotificationTransport } from "./notification-transport.port";

export class DeliverNotificationUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly transport: NotificationTransport,
  ) {}

  async execute(deliveryId: string): Promise<void> {
    const delivery =
      await this.uow.notificationDeliveryRepository.claimForDelivery(
        deliveryId,
        new Date(),
        5 * 60_000,
      );
    if (!delivery) return;
    const processingStartedAt = delivery.processingStartedAt;
    if (!processingStartedAt) return;

    const channel = await this.uow.notificationChannelRepository.findById(
      delivery.channelId,
    );
    if (!channel) {
      await this.uow.notificationDeliveryRepository.updateClaimed(
        delivery.id,
        processingStartedAt,
        {
          status: "dead_letter",
          processingStartedAt: null,
          error: "Notification channel no longer exists",
        },
      );
      return;
    }

    try {
      await this.transport.send(decryptNotificationConfiguration(channel), {
        title: delivery.title,
        message: delivery.message,
        metadata: delivery.metadata,
      });
      await this.uow.notificationDeliveryRepository.updateClaimed(
        delivery.id,
        processingStartedAt,
        {
          status: "delivered",
          deliveredAt: new Date(),
          processingStartedAt: null,
          nextAttemptAt: null,
          error: null,
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown delivery error";
      await this.uow.notificationDeliveryRepository.updateClaimed(
        delivery.id,
        processingStartedAt,
        {
          status: delivery.attempts >= 3 ? "dead_letter" : "failed",
          error: message.slice(0, 1_000),
          processingStartedAt: null,
          nextAttemptAt: new Date(
            Date.now() + Math.min(60_000, 2 ** delivery.attempts * 1_000),
          ),
        },
      );
      throw error;
    }
  }
}
