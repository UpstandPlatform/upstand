import type {
  Environment,
  IUnitOfWork,
  Project,
  Resource,
} from "@upstand/domain";

const REPOSITORY_READ_CONCURRENCY = 16;

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) return [];

  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(REPOSITORY_READ_CONCURRENCY, values.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= values.length) return;
        results[index] = await mapper(values[index] as T);
      }
    }),
  );

  return results;
}

export async function findOrganizationResourceIds(
  uow: IUnitOfWork,
  organizationId: string,
): Promise<string[]> {
  if (uow.resourceRepository.findIdsByOrganizationId) {
    return uow.resourceRepository.findIdsByOrganizationId(organizationId);
  }

  const projects =
    await uow.projectRepository.findByOrganizationId(organizationId);
  const environmentIdGroups = await mapWithConcurrency(
    projects.map((project) => project.id),
    async (projectId) => {
      if (uow.environmentRepository.findIdsByProjectId) {
        return uow.environmentRepository.findIdsByProjectId(projectId);
      }
      return (await uow.environmentRepository.findByProjectId(projectId)).map(
        (environment) => environment.id,
      );
    },
  );
  const environmentIds = environmentIdGroups.flat();
  const resourceIdGroups = await mapWithConcurrency(
    environmentIds,
    async (environmentId) => {
      if (uow.resourceRepository.findIdsByEnvironmentId) {
        return uow.resourceRepository.findIdsByEnvironmentId(environmentId);
      }
      return (
        await uow.resourceRepository.findByEnvironmentId(environmentId)
      ).map((resource) => resource.id);
    },
  );
  return resourceIdGroups.flat();
}

export type OrganizationResourceTopology = {
  projects: Project[];
  environments: Environment[];
  resources: Resource[];
};

export async function findOrganizationResourceTopology(
  uow: IUnitOfWork,
  organizationId: string,
): Promise<OrganizationResourceTopology> {
  const projects =
    await uow.projectRepository.findByOrganizationId(organizationId);
  const projectIds = new Set(projects.map((project) => project.id));
  const environmentGroups = await mapWithConcurrency(
    [...projectIds],
    (projectId) => uow.environmentRepository.findByProjectId(projectId),
  );
  const environments = environmentGroups.flat();
  const environmentIds = new Set(environments.map((env) => env.id));
  const resourceGroups = await mapWithConcurrency(
    [...environmentIds],
    (environmentId) =>
      uow.resourceRepository.findByEnvironmentId(environmentId),
  );
  return {
    projects,
    environments,
    resources: resourceGroups.flat(),
  };
}

export async function findOrganizationResources(
  uow: IUnitOfWork,
  organizationId: string,
) {
  return (await findOrganizationResourceTopology(uow, organizationId))
    .resources;
}
