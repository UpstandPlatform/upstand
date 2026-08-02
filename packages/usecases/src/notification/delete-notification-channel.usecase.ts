import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { z } from "zod";

export const DeleteNotificationChannelInputSchema = z.object({
  id: z.string().min(1, "Notification channel ID is required"),
  organizationId: z.string().min(1, "Organization ID is required").optional(),
});

export type DeleteNotificationChannelInput = z.infer<
  typeof DeleteNotificationChannelInputSchema
>;

export class DeleteNotificationChannelUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: DeleteNotificationChannelInput): Promise<void> {
    const channel = await this.uow.notificationChannelRepository.findById(
      input.id,
    );
    if (
      !channel ||
      !input.organizationId ||
      channel.organizationId !== input.organizationId
    ) {
      throw new ValidationError("Notification channel not found");
    }
    const deleted = await this.uow.notificationChannelRepository.deleteById(
      input.id,
    );
    if (!deleted) throw new ValidationError("Notification channel not found");
  }
}
