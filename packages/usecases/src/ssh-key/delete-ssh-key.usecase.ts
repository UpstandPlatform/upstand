import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { z } from "zod";

export const DeleteSshKeyInputSchema = z.object({
  id: z.string().min(1, "Key ID is required"),
  organizationId: z.string().min(1, "Organization ID is required").optional(),
});

export type DeleteSshKeyInput = z.infer<typeof DeleteSshKeyInputSchema>;

export class DeleteSshKeyUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: DeleteSshKeyInput): Promise<boolean> {
    return this.uow.transaction(async (tx) => {
      const key = await tx.sshKeyRepository.findById(input.id);
      if (
        !key ||
        !input.organizationId ||
        key.organizationId !== input.organizationId
      ) {
        throw new ValidationError("SSH Key not found");
      }
      return await tx.sshKeyRepository.deleteById(input.id);
    });
  }
}
