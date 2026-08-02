import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";

export const DeleteS3DestinationInputSchema = z.object({
  id: z.string().min(1, "ID is required"),
  organizationId: z.string().min(1).optional(),
});

export type DeleteS3DestinationInput = z.infer<
  typeof DeleteS3DestinationInputSchema
>;

export class DeleteS3DestinationUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: DeleteS3DestinationInput): Promise<boolean> {
    return this.uow.transaction(async (tx) => {
      const existing = await tx.s3DestinationRepository.findById(input.id);
      if (!existing || existing.organizationId !== input.organizationId) {
        return false;
      }
      return await tx.s3DestinationRepository.deleteById(input.id);
    });
  }
}
