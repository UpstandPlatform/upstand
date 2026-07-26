import { randomUUID } from "node:crypto";
import type { IUnitOfWork, Project } from "@upstand/domain";
import { z } from "zod";

export const CreateProjectInputSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  description: z.string().optional().nullable(),
  organizationId: z.string().min(1, "Organization ID is required"),
});

export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export class CreateProjectUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: CreateProjectInput): Promise<Project> {
    return this.uow.transaction(async (tx) => {
      const project = await tx.projectRepository.create({
        id: randomUUID(),
        name: input.name,
        description: input.description ?? null,
        organizationId: input.organizationId,
      });

      await tx.environmentRepository.create({
        id: randomUUID(),
        projectId: project.id,
        name: "production",
        slug: "production",
        isDefault: true,
        isProtected: true,
        resourceCount: 0,
      });

      return project;
    });
  }
}
