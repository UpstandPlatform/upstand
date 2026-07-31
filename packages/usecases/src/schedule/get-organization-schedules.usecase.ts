import type { IUnitOfWork, Schedule } from "@upstand/domain";
import { z } from "zod";
import { findOrganizationResourceIds } from "../deployment/organization-resources.helper";

export const GetOrganizationSchedulesInputSchema = z.object({
  organizationId: z.string().min(1),
});

export type OrganizationSchedule = Schedule & {
  resourceName: string | null;
  projectId: string | null;
  projectName: string | null;
  environmentId: string | null;
  environmentName: string | null;
};

export class GetOrganizationSchedulesUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: z.infer<typeof GetOrganizationSchedulesInputSchema>,
  ): Promise<OrganizationSchedule[]> {
    const resourceIds = await findOrganizationResourceIds(
      this.uow,
      input.organizationId,
    );
    const schedules = (
      await Promise.all(
        resourceIds.map((resourceId) =>
          this.uow.scheduleRepository.findByResourceId(resourceId),
        ),
      )
    ).flat();

    if (schedules.length === 0) return [];

    const uniqueResourceIds = [
      ...new Set(
        schedules
          .map((s) => s.resourceId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const resourceEntities = await Promise.all(
      uniqueResourceIds.map((id) => this.uow.resourceRepository.findById(id)),
    );
    const resourceMap = new Map(
      resourceEntities
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .map((r) => [r.id, r]),
    );

    const uniqueEnvIds = [
      ...new Set(
        [...resourceMap.values()].map((r) => r.environmentId).filter(Boolean),
      ),
    ];

    const envEntities = await Promise.all(
      uniqueEnvIds.map((id) => this.uow.environmentRepository.findById(id)),
    );
    const envMap = new Map(
      envEntities
        .filter((e): e is NonNullable<typeof e> => e !== null)
        .map((e) => [e.id, e]),
    );

    const uniqueProjectIds = [
      ...new Set([...envMap.values()].map((e) => e.projectId).filter(Boolean)),
    ];

    const projectEntities = await Promise.all(
      uniqueProjectIds.map((id) => this.uow.projectRepository.findById(id)),
    );
    const projectMap = new Map(
      projectEntities
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map((p) => [p.id, p]),
    );

    return schedules.map((schedule) => {
      const resource = schedule.resourceId
        ? resourceMap.get(schedule.resourceId)
        : null;
      const environment = resource ? envMap.get(resource.environmentId) : null;
      const project = environment
        ? projectMap.get(environment.projectId)
        : null;
      return {
        ...schedule,
        resourceName: resource?.name ?? null,
        projectId: project?.id ?? null,
        projectName: project?.name ?? null,
        environmentId: environment?.id ?? null,
        environmentName: environment?.name ?? null,
      };
    });
  }
}
