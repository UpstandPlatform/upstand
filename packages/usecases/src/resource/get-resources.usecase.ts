import type { IUnitOfWork, Resource } from "@upstand/domain";
import { z } from "zod";

export const GetResourcesInputSchema = z.object({
  environmentId: z.string().min(1, "Environment ID is required"),
});

export type GetResourcesInput = z.infer<typeof GetResourcesInputSchema>;

export class GetResourcesUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetResourcesInput): Promise<Resource[]> {
    return this.uow.transaction(async (tx) => {
      return await tx.resourceRepository.findByEnvironmentId(
        input.environmentId,
      );
    });
  }
}
