import type { IUnitOfWork, Project } from "@upstand/domain";
import { EntityIconSchema, ValidationError } from "@upstand/domain";
import { z } from "zod";

export const UpdateProjectInputSchema = z.object({
  id: z.string().min(1, "Project ID is required"),
  organizationId: z.string().min(1, "Organization ID is required").optional(),
  name: z.string().min(1, "Project name cannot be empty").optional(),
  description: z.string().optional().nullable(),
  icon: EntityIconSchema,
  archived: z.boolean().optional(),
});

export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;

export class UpdateProjectUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: UpdateProjectInput): Promise<Project> {
    const project = await this.uow.projectRepository.findById(input.id);
    if (!project) {
      throw new ValidationError("Project not found");
    }
    if (
      !input.organizationId ||
      project.organizationId !== input.organizationId
    ) {
      throw new ValidationError("Project not found");
    }

    const patch: {
      name?: string;
      description?: string | null;
      icon?: string | null;
      archivedAt?: Date | null;
    } = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.icon !== undefined) patch.icon = input.icon;
    if (input.archived !== undefined) {
      patch.archivedAt = input.archived ? new Date() : null;
    }

    const updated = await this.uow.projectRepository.updateById(
      input.id,
      patch,
    );

    if (!updated) {
      throw new ValidationError("Failed to update project");
    }

    return updated;
  }
}
