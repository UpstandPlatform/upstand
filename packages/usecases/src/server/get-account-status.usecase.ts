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
    const environments = (
      await Promise.all(
        projects.map((project) =>
          this.uow.environmentRepository.findByProjectId(project.id),
        ),
      )
    ).flat();
    const resources = (
      await Promise.all(
        environments.map((environment) =>
          this.uow.resourceRepository.findByEnvironmentId(environment.id),
        ),
      )
    ).flat();
    const deployments = (
      await Promise.all(
        resources.map((resource) =>
          this.uow.deploymentRepository.findByResourceId(resource.id),
        ),
      )
    ).flat();
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
