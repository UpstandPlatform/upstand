import type {
  CreateNotificationDeliveryDTO,
  ListNotificationDeliveriesInput,
  ListNotificationDeliveriesResult,
  NotificationDelivery,
} from "../entities/notification";

export interface INotificationDeliveryRepository {
  findById(id: string): Promise<NotificationDelivery | null>;
  findRecentByOrganizationId(
    organizationId: string,
    limit?: number,
  ): Promise<NotificationDelivery[]>;
  findByStatus(status: string, limit?: number): Promise<NotificationDelivery[]>;
  list(
    input: ListNotificationDeliveriesInput,
  ): Promise<ListNotificationDeliveriesResult>;
  claimForDelivery(
    id: string,
    now: Date,
    leaseMs: number,
  ): Promise<NotificationDelivery | null>;
  create(data: CreateNotificationDeliveryDTO): Promise<NotificationDelivery>;
  createMany(
    data: CreateNotificationDeliveryDTO[],
  ): Promise<NotificationDelivery[]>;
  updateById(
    id: string,
    patch: Partial<CreateNotificationDeliveryDTO>,
  ): Promise<NotificationDelivery | null>;
  updateClaimed(
    id: string,
    processingStartedAt: Date,
    patch: Partial<CreateNotificationDeliveryDTO>,
  ): Promise<NotificationDelivery | null>;
  requeueIfRetryable?(
    id: string,
    expectedUpdatedAt: Date,
  ): Promise<NotificationDelivery | null>;
}
