import { environment, project, resource } from "@upstand/db";
import type {
  CreateProjectDTO,
  IProjectRepository,
  OrganizationSearchMatch,
  Project,
} from "@upstand/domain";
import { and, asc, eq, ilike, isNull, or } from "drizzle-orm";
import { BaseRepository } from "../shared/base.repository";
import type { Executor } from "../shared/types";

export class DrizzleProjectRepository
  extends BaseRepository<typeof project, Project, CreateProjectDTO>
  implements IProjectRepository
{
  constructor(executor: Executor) {
    super(executor, project);
  }

  async delete(id: string): Promise<Project | null> {
    return this.deleteByIdReturning(id);
  }

  async findByOrganizationId(
    organizationId: string,
    options?: { includeArchived?: boolean },
  ): Promise<Project[]> {
    return this.findMany({
      where: options?.includeArchived
        ? eq(project.organizationId, organizationId)
        : and(
            eq(project.organizationId, organizationId),
            isNull(project.archivedAt),
          ),
    });
  }

  async searchByOrganizationId(
    organizationId: string,
    query: string,
    limit: number,
  ): Promise<OrganizationSearchMatch[]> {
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 50));
    const pattern = `%${escapeLikePattern(query.trim())}%`;

    const [projects, environments, resources] = await Promise.all([
      this.executor
        .select({
          id: project.id,
          name: project.name,
        })
        .from(project)
        .where(
          and(
            eq(project.organizationId, organizationId),
            isNull(project.archivedAt),
            ilike(project.name, pattern),
          ),
        )
        .orderBy(asc(project.name), asc(project.id))
        .limit(safeLimit),
      this.executor
        .select({
          id: environment.id,
          name: environment.name,
          projectId: project.id,
          projectName: project.name,
        })
        .from(environment)
        .innerJoin(project, eq(environment.projectId, project.id))
        .where(
          and(
            eq(project.organizationId, organizationId),
            isNull(project.archivedAt),
            ilike(environment.name, pattern),
          ),
        )
        .orderBy(asc(project.name), asc(environment.name), asc(environment.id))
        .limit(safeLimit),
      this.executor
        .select({
          id: resource.id,
          name: resource.name,
          appName: resource.appName,
          environmentId: environment.id,
          environmentName: environment.name,
          projectId: project.id,
          projectName: project.name,
        })
        .from(resource)
        .innerJoin(environment, eq(resource.environmentId, environment.id))
        .innerJoin(project, eq(environment.projectId, project.id))
        .where(
          and(
            eq(project.organizationId, organizationId),
            isNull(project.archivedAt),
            or(ilike(resource.name, pattern), ilike(resource.appName, pattern)),
          ),
        )
        .orderBy(
          asc(project.name),
          asc(environment.name),
          asc(resource.name),
          asc(resource.id),
        )
        .limit(safeLimit),
    ]);

    return [
      ...projects.map((row) => ({
        type: "project" as const,
        id: row.id,
        name: row.name,
        projectId: row.id,
        projectName: row.name,
      })),
      ...environments.map((row) => ({
        type: "environment" as const,
        id: row.id,
        name: row.name,
        projectId: row.projectId,
        projectName: row.projectName,
        environmentId: row.id,
        environmentName: row.name,
      })),
      ...resources.map((row) => ({
        type: "resource" as const,
        id: row.id,
        name: row.name,
        appName: row.appName,
        projectId: row.projectId,
        projectName: row.projectName,
        environmentId: row.environmentId,
        environmentName: row.environmentName,
      })),
    ].slice(0, safeLimit);
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
