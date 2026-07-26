import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { z } from "zod";

export const DeleteServerInputSchema = z.object({
  id: z.string().min(1, "Server ID is required"),
});

export type DeleteServerInput = z.infer<typeof DeleteServerInputSchema>;

export class DeleteServerUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: DeleteServerInput): Promise<boolean> {
    const assignedResources = (
      await this.uow.resourceRepository.findMany()
    ).filter(
      (resource) =>
        resource.serverId === input.id || resource.buildServerId === input.id,
    );
    if (assignedResources.length > 0) {
      throw new ValidationError(
        `Server is assigned to ${assignedResources.length} resource${assignedResources.length === 1 ? "" : "s"}. Reassign those resources before deleting the server.`,
      );
    }

    return this.uow.transaction(async (tx) => {
      return tx.serverRepository.deleteById(input.id);
    });
  }
}
