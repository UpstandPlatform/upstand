import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { z } from "zod";

export const DeleteEnvironmentInputSchema = z.object({
  id: z.string().min(1, "Environment ID is required"),
});

export type DeleteEnvironmentInput = z.infer<
  typeof DeleteEnvironmentInputSchema
>;

export class DeleteEnvironmentUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: DeleteEnvironmentInput): Promise<boolean> {
    return this.uow.transaction(async (tx) => {
      const environment = await tx.environmentRepository.findById(input.id);
      if (!environment) {
        throw new ValidationError("Environment not found");
      }

      if (environment.isDefault || environment.isProtected) {
        throw new ValidationError(
          "Cannot delete the default/production environment.",
        );
      }

      if (environment.resourceCount > 0) {
        throw new ValidationError(
          "Cannot delete environment. Please delete all services/resources inside it first.",
        );
      }

      return await tx.environmentRepository.deleteById(input.id);
    });
  }
}
