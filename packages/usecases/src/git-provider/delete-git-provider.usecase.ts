import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";

export const DeleteGitProviderInputSchema = z.object({
  id: z.string().min(1, "Git Provider ID is required"),
});

export type DeleteGitProviderInput = z.infer<
  typeof DeleteGitProviderInputSchema
>;

export class DeleteGitProviderUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: DeleteGitProviderInput): Promise<boolean> {
    return this.uow.transaction(async (tx) => {
      return await tx.gitProviderRepository.deleteById(input.id);
    });
  }
}
