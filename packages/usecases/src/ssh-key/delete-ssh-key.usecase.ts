import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { z } from "zod";

export const DeleteSshKeyInputSchema = z.object({
  id: z.string().min(1, "Key ID is required"),
});

export type DeleteSshKeyInput = z.infer<typeof DeleteSshKeyInputSchema>;

export class DeleteSshKeyUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: DeleteSshKeyInput): Promise<boolean> {
    return this.uow.transaction(async (tx) => {
      const key = await tx.sshKeyRepository.findById(input.id);
      if (!key) {
        throw new ValidationError("SSH Key not found");
      }
      return await tx.sshKeyRepository.deleteById(input.id);
    });
  }
}
