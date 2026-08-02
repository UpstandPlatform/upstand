import type {
  CreateProjectDTO,
  Project,
  UpdateProjectDTO,
} from "../entities/project";

export type OrganizationSearchMatch = {
  type: "project" | "environment" | "resource";
  id: string;
  name: string;
  appName?: string | null;
  projectId: string;
  projectName: string;
  environmentId?: string;
  environmentName?: string;
};

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
  /** Search tenant-owned names without hydrating environment/resource secrets. */
  searchByOrganizationId?(
    organizationId: string,
    query: string,
    limit: number,
  ): Promise<OrganizationSearchMatch[]>;
}
