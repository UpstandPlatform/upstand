import { type IUnitOfWork, ValidationError } from "@upstand/domain";

export class DeleteNotificationChannelUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(id: string): Promise<void> {
    const deleted = await this.uow.notificationChannelRepository.deleteById(id);
    if (!deleted) throw new ValidationError("Notification channel not found");
  }
}
