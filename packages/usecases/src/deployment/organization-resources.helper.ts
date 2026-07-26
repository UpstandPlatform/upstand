import type { IUnitOfWork } from "@upstand/domain";

export async function findOrganizationResourceIds(
  uow: IUnitOfWork,
  organizationId: string,
): Promise<string[]> {
  const projects =
    await uow.projectRepository.findByOrganizationId(organizationId);
  const projectIds = new Set(projects.map((project) => project.id));
  const environments = [];
  for (const projectId of projectIds) {
    const envs = await uow.environmentRepository.findByProjectId(projectId);
    environments.push(...envs);
  }
  const environmentIds = new Set(environments.map((env) => env.id));
  const resources = [];
  for (const envId of environmentIds) {
    const res = await uow.resourceRepository.findByEnvironmentId(envId);
    resources.push(...res);
  }
  return resources.map((resource) => resource.id);
}
