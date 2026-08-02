import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { z } from "zod";

export const DeleteServerInputSchema = z.object({
  id: z.string().min(1, "Server ID is required"),
  organizationId: z.string().min(1).optional(),
});

export type DeleteServerInput = z.infer<typeof DeleteServerInputSchema>;

export class DeleteServerUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: DeleteServerInput): Promise<boolean> {
    const server = await this.uow.serverRepository.findById(input.id);
    if (!server) throw new ValidationError("Server not found");
    if (input.organizationId !== server.organizationId) {
      throw new ValidationError("Server belongs to another organization");
    }
    const assignedResources = await this.uow.resourceRepository.findByServerId(
      input.id,
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
