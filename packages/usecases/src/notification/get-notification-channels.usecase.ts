import {
  type IUnitOfWork,
  type NotificationChannelView,
  toNotificationChannelView,
} from "@upstand/domain";

export class GetNotificationChannelsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(organizationId: string): Promise<NotificationChannelView[]> {
    const channels =
      await this.uow.notificationChannelRepository.findByOrganizationId(
        organizationId,
      );
    return channels.map(toNotificationChannelView);
  }
}
