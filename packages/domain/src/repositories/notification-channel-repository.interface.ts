import type {
  CreateNotificationChannelInput,
  NotificationChannel,
  NotificationEventType,
} from "../entities/notification";

export interface INotificationChannelRepository {
  findById(id: string): Promise<NotificationChannel | null>;
  findByOrganizationId(organizationId: string): Promise<NotificationChannel[]>;
  findByEvent(
    event: NotificationEventType,
    organizationId?: string,
  ): Promise<NotificationChannel[]>;
  create(
    data: Omit<CreateNotificationChannelInput, "configuration"> & {
      id: string;
      provider: NotificationChannel["provider"];
      encryptedConfiguration: string;
      configurationSummary: Record<string, unknown>;
    },
  ): Promise<NotificationChannel>;
  updateById(
    id: string,
    patch: Partial<
      Pick<
        NotificationChannel,
        "name" | "events" | "encryptedConfiguration" | "configurationSummary"
      >
    >,
  ): Promise<NotificationChannel | null>;
  deleteById(id: string): Promise<boolean>;
}
