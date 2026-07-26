import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { decryptNotificationConfiguration } from "./notification-configuration";
import type { NotificationTransport } from "./notification-transport.port";

export class TestNotificationChannelUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly transport: NotificationTransport,
  ) {}

  async execute(id: string): Promise<void> {
    const channel = await this.uow.notificationChannelRepository.findById(id);
    if (!channel) throw new ValidationError("Notification channel not found");

    await this.transport.send(decryptNotificationConfiguration(channel), {
      title: "Upstand notification test",
      message:
        "This is a test notification from Upstand. Your channel is ready.",
    });
  }
}
