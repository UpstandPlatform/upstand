import type { IUnitOfWork, UpdateResourceDTO } from "@upstand/domain";
import { z } from "zod";

export const DeleteDockerRegistryInputSchema = z.object({
  id: z.string().min(1, "Registry ID is required"),
  organizationId: z.string().min(1, "Organization ID is required").optional(),
});

export type DeleteDockerRegistryInput = z.infer<
  typeof DeleteDockerRegistryInputSchema
>;

export class DeleteDockerRegistryUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: DeleteDockerRegistryInput): Promise<boolean> {
    return this.uow.transaction(async (tx) => {
      const registry = await tx.dockerRegistryRepository.findById(input.id);
      if (
        !registry ||
        !input.organizationId ||
        registry.organizationId !== input.organizationId
      ) {
        return false;
      }
      const referencingResources =
        await tx.resourceRepository.findByDockerRegistryId(input.id);
      for (const res of referencingResources) {
        const updates: UpdateResourceDTO = {};
        if (res.rollbackRegistryId === input.id) {
          updates.rollbackActive = false;
          updates.rollbackRegistryId = null;
        }
        if (res.buildRegistryId === input.id) {
          updates.buildRegistryId = null;
        }
        if (Object.keys(updates).length > 0) {
          await tx.resourceRepository.updateById(res.id, updates);
        }
      }
      return tx.dockerRegistryRepository.deleteById(input.id);
    });
  }
}
