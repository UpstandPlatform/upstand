import { project } from "@upstand/db";
import type {
  CreateProjectDTO,
  IProjectRepository,
  Project,
} from "@upstand/domain";
import { and, eq, isNull } from "drizzle-orm";
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
}
