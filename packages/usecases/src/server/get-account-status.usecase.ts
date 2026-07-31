import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";

export const GetAccountStatusInputSchema = z.object({
  organizationId: z.string().min(1),
});

export type GetAccountStatusInput = z.infer<typeof GetAccountStatusInputSchema>;

export type AccountStatus = {
  organizationId: string;
  projectCount: number;
  environmentCount: number;
  resourceCount: number;
  serverCount: number;
  recentDeploymentCount: number;
  checkedAt: string;
};

export class GetAccountStatusUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetAccountStatusInput): Promise<AccountStatus> {
    const [projects, servers] = await Promise.all([
      this.uow.projectRepository.findByOrganizationId(input.organizationId),
      this.uow.serverRepository.findByOrganizationId(input.organizationId),
    ]);

    if (projects.length === 0) {
      return {
        organizationId: input.organizationId,
        projectCount: 0,
        environmentCount: 0,
        resourceCount: 0,
        serverCount: servers.length,
        recentDeploymentCount: 0,
        checkedAt: new Date().toISOString(),
      };
    }

    const environments = (
      await Promise.all(
        projects.map((project) =>
          this.uow.environmentRepository.findByProjectId(project.id),
        ),
      )
    ).flat();

    if (environments.length === 0) {
      return {
        organizationId: input.organizationId,
        projectCount: projects.length,
        environmentCount: 0,
        resourceCount: 0,
        serverCount: servers.length,
        recentDeploymentCount: 0,
        checkedAt: new Date().toISOString(),
      };
    }

    const resources = (
      await Promise.all(
        environments.map((environment) =>
          this.uow.resourceRepository.findByEnvironmentId(environment.id),
        ),
      )
    ).flat();

    const resourceIds = resources.map((r) => r.id);
    const deployments =
      resourceIds.length > 0
        ? await this.uow.deploymentRepository.findRecentByResourceIds(
            resourceIds,
          )
        : [];

    return {
      organizationId: input.organizationId,
      projectCount: projects.length,
      environmentCount: environments.length,
      resourceCount: resources.length,
      serverCount: servers.length,
      recentDeploymentCount: deployments.length,
      checkedAt: new Date().toISOString(),
    };
  }
}
