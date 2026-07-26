import type { IUnitOfWork, Project } from "@upstand/domain";
import { z } from "zod";

export const GetProjectsInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
  includeArchived: z.boolean().default(false),
});

export type GetProjectsInput = z.infer<typeof GetProjectsInputSchema>;

export class GetProjectsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetProjectsInput): Promise<Project[]> {
    return this.uow.transaction(async (tx) => {
      return await tx.projectRepository.findByOrganizationId(
        input.organizationId,
        { includeArchived: input.includeArchived },
      );
    });
  }
}
