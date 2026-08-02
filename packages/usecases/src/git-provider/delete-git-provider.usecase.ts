import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";

export const DeleteGitProviderInputSchema = z.object({
  id: z.string().min(1, "Git Provider ID is required"),
  organizationId: z.string().min(1, "Organization ID is required").optional(),
});

export type DeleteGitProviderInput = z.infer<
  typeof DeleteGitProviderInputSchema
>;

export class DeleteGitProviderUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: DeleteGitProviderInput): Promise<boolean> {
    return this.uow.transaction(async (tx) => {
      const provider = await tx.gitProviderRepository.findById(input.id);
      if (
        !provider ||
        !input.organizationId ||
        provider.organizationId !== input.organizationId
      ) {
        return false;
      }
      return await tx.gitProviderRepository.deleteById(input.id);
    });
  }
}
