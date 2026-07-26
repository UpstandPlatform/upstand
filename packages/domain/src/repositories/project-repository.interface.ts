import type {
  CreateProjectDTO,
  Project,
  UpdateProjectDTO,
} from "../entities/project";

export interface IProjectRepository {
  findById(id: string): Promise<Project | null>;
  findMany(): Promise<Project[]>;
  create(data: CreateProjectDTO): Promise<Project>;
  updateById(id: string, patch: UpdateProjectDTO): Promise<Project | null>;
  delete(id: string): Promise<Project | null>;
  findByOrganizationId(
    organizationId: string,
    options?: { includeArchived?: boolean },
  ): Promise<Project[]>;
}
