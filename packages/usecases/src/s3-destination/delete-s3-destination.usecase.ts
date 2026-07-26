import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";

export const DeleteS3DestinationInputSchema = z.object({
  id: z.string().min(1, "ID is required"),
});

export type DeleteS3DestinationInput = z.infer<
  typeof DeleteS3DestinationInputSchema
>;

export class DeleteS3DestinationUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: DeleteS3DestinationInput): Promise<boolean> {
    return this.uow.transaction(async (tx) => {
      return await tx.s3DestinationRepository.deleteById(input.id);
    });
  }
}
