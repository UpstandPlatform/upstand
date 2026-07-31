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

    const resources = await Promise.all(
      schedules.map((schedule) =>
        schedule.resourceId
          ? this.uow.resourceRepository.findById(schedule.resourceId)
          : Promise.resolve(null),
      ),
    );
    const environments = await Promise.all(
      resources.map((resource) =>
        resource
          ? this.uow.environmentRepository.findById(resource.environmentId)
          : Promise.resolve(null),
      ),
    );
    const projects = await Promise.all(
      environments.map((environment) =>
        environment
          ? this.uow.projectRepository.findById(environment.projectId)
          : Promise.resolve(null),
      ),
    );

    return schedules.map((schedule, index) => {
      const resource = resources[index];
      const environment = environments[index];
      const project = projects[index];
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
