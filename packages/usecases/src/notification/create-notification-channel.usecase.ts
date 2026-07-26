import { randomUUID } from "node:crypto";
import {
  type CreateNotificationChannelInput,
  CreateNotificationChannelInputSchema,
  type IUnitOfWork,
  type NotificationChannelView,
  summarizeNotificationConfiguration,
  toNotificationChannelView,
} from "@upstand/domain";
import { encryptNotificationConfiguration } from "./notification-configuration";

export class CreateNotificationChannelUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: CreateNotificationChannelInput,
  ): Promise<NotificationChannelView> {
    const validated = CreateNotificationChannelInputSchema.parse(input);
    const channel = await this.uow.notificationChannelRepository.create({
      id: randomUUID(),
      organizationId: validated.organizationId,
      name: validated.name,
      events: [...new Set(validated.events)],
      provider: validated.configuration.type,
      encryptedConfiguration: encryptNotificationConfiguration(
        validated.configuration,
      ),
      configurationSummary: summarizeNotificationConfiguration(
        validated.configuration,
      ),
    });
    return toNotificationChannelView(channel);
  }
}
