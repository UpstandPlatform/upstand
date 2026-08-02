import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";
import { findOrganizationResourceTopology } from "../deployment/organization-resources.helper";

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
    const [topology, servers] = await Promise.all([
      findOrganizationResourceTopology(this.uow, input.organizationId),
      this.uow.serverRepository.findByOrganizationId(input.organizationId),
    ]);
    const { projects, environments, resources } = topology;

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
