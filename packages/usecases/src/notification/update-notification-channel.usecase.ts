import {
  type IUnitOfWork,
  type NotificationChannelView,
  NotificationConfigurationSchema,
  summarizeNotificationConfiguration,
  toNotificationChannelView,
  type UpdateNotificationChannelInput,
  UpdateNotificationChannelInputSchema,
  ValidationError,
} from "@upstand/domain";
import {
  decryptNotificationConfiguration,
  encryptNotificationConfiguration,
} from "./notification-configuration";

export class UpdateNotificationChannelUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: UpdateNotificationChannelInput,
  ): Promise<NotificationChannelView> {
    const validated = UpdateNotificationChannelInputSchema.parse(input);
    const channel = await this.uow.notificationChannelRepository.findById(
      validated.id,
    );
    if (!channel) throw new ValidationError("Notification channel not found");

    const patch: Parameters<
      IUnitOfWork["notificationChannelRepository"]["updateById"]
    >[1] = {
      ...(validated.name ? { name: validated.name } : {}),
      ...(validated.events ? { events: [...new Set(validated.events)] } : {}),
    };

    if (validated.configuration) {
      const previous = decryptNotificationConfiguration(channel);
      const merged = NotificationConfigurationSchema.parse({
        ...previous,
        ...validated.configuration,
        type: channel.provider,
      });
      patch.encryptedConfiguration = encryptNotificationConfiguration(merged);
      patch.configurationSummary = summarizeNotificationConfiguration(merged);
    }

    const updated = await this.uow.notificationChannelRepository.updateById(
      channel.id,
      patch,
    );
    if (!updated)
      throw new ValidationError("Unable to update notification channel");
    return toNotificationChannelView(updated);
  }
}
