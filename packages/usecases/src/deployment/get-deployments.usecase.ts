import type { Environment, IUnitOfWork, Project } from "@upstand/domain";
import { findOrganizationResourceIds } from "./organization-resources.helper";

export interface DeploymentHistoryResult {
  id: string;
  resourceId: string;
  resourceName: string;
  resourceType: string;
  environmentId: string | null;
  projectId: string | null;
  environmentName: string;
  projectName: string;
  serverId: string | null;
  serverName: string | null;
  title: string;
  status: string;
  logs: string;
  createdAt: string;
}

export class GetDeploymentsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async executeForOrganization(
    organizationId: string,
  ): Promise<DeploymentHistoryResult[]> {
    const resourceIds = await findOrganizationResourceIds(
      this.uow,
      organizationId,
    );
    return this.execute(resourceIds);
  }

  async execute(
    resourceIds?: readonly string[],
  ): Promise<DeploymentHistoryResult[]> {
    // Deployment history is always scoped to known resource IDs. The optional
    // argument is used by organization-aware callers; the unscoped form is
    // retained for internal maintenance tooling only.
    const resources = resourceIds
      ? await Promise.all(
          resourceIds.map((resourceId) =>
            this.uow.resourceRepository.findById(resourceId),
          ),
        ).then((items) =>
          items.filter(
            (resource): resource is NonNullable<typeof resource> =>
              resource !== null,
          ),
        )
      : await this.uow.resourceRepository.findMany();
    const deployments = resourceIds
      ? await this.uow.deploymentRepository.findRecentByResourceIds(
          resourceIds,
          500,
        )
      : await this.uow.deploymentRepository.findRecent(500);

    // Fetch environments and projects to enrich data
    let environments: Environment[];
    let projects: Project[];
    if (resourceIds) {
      const envIds = [...new Set(resources.map((r) => r.environmentId))];
      environments = await Promise.all(
        envIds.map((envId) => this.uow.environmentRepository.findById(envId)),
      ).then((items) =>
        items.filter((env): env is NonNullable<typeof env> => env !== null),
      );

      const projectIds = [...new Set(environments.map((env) => env.projectId))];
      projects = await Promise.all(
        projectIds.map((projectId) =>
          this.uow.projectRepository.findById(projectId),
        ),
      ).then((items) =>
        items.filter((p): p is NonNullable<typeof p> => p !== null),
      );
    } else {
      environments = await this.uow.environmentRepository.findMany();
      projects = await this.uow.projectRepository.findMany();
    }

    const resourceMap = new Map(
      resources.map((resource) => [resource.id, resource]),
    );
    const envMap = new Map(
      environments.map((environment) => [environment.id, environment]),
    );
    const projectMap = new Map(
      projects.map((project) => [project.id, project]),
    );

    return deployments.map((dep) => {
      const resource = resourceMap.get(dep.resourceId);
      const env = resource ? envMap.get(resource.environmentId) : null;
      const proj = env ? projectMap.get(env.projectId) : null;

      return {
        id: dep.id,
        resourceId: dep.resourceId,
        resourceName: resource?.name || "Unknown Service",
        resourceType: resource?.type || "unknown",
        environmentId: env?.id ?? null,
        projectId: proj?.id ?? null,
        environmentName: env?.name || "Unknown Env",
        projectName: proj?.name || "Unknown Project",
        serverId: dep.serverId || null,
        serverName: dep.serverName || "Upstand Server",
        title: dep.title,
        status: dep.status,
        logs: dep.logs,
        createdAt: dep.createdAt.toISOString(),
      };
    });
  }
}
