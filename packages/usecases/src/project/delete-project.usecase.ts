import {
  type IUnitOfWork,
  type Project,
  ValidationError,
} from "@upstand/domain";
import { z } from "zod";

export const DeleteProjectInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
  id: z.string(),
});

export type DeleteProjectInput = z.infer<typeof DeleteProjectInputSchema>;

export class DeleteProjectUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: DeleteProjectInput): Promise<Project | null> {
    return this.uow.transaction(async (tx) => {
      const environments = await tx.environmentRepository.findByProjectId(
        input.id,
      );
      const hasResources = environments.some((env) => env.resourceCount > 0);
      if (hasResources) {
        throw new ValidationError(
          "Cannot delete project. Please delete all services/resources in all environments first.",
        );
      }

      return tx.projectRepository.delete(input.id);
    });
  }
}
