import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";
import { findOrganizationResourceTopology } from "../deployment/organization-resources.helper";

export const GlobalSearchInputSchema = z.object({
  organizationId: z.string().min(1),
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(50).default(20),
});

export type GlobalSearchResult = {
  type: "project" | "environment" | "resource";
  id: string;
  name: string;
  subtitle: string;
  href: string;
};

export class GlobalSearchUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: z.infer<typeof GlobalSearchInputSchema>) {
    const query = input.query.toLowerCase();
    const repositorySearch = this.uow.projectRepository.searchByOrganizationId;
    if (repositorySearch) {
      const matches = await repositorySearch(
        input.organizationId,
        query,
        input.limit,
      );
      return matches.map((match) => {
        if (match.type === "project") {
          return {
            type: "project" as const,
            id: match.id,
            name: match.name,
            subtitle: "Project",
            href: `/projects/${match.id}`,
          };
        }
        if (match.type === "environment") {
          return {
            type: "environment" as const,
            id: match.id,
            name: match.name,
            subtitle: match.projectName,
            href: `/projects/${match.projectId}/${match.id}`,
          };
        }
        return {
          type: "resource" as const,
          id: match.id,
          name: match.name,
          subtitle: `${match.projectName} / ${match.environmentName ?? "Environment"}`,
          href: `/projects/${match.projectId}/${match.environmentId}/${match.id}`,
        };
      });
    }

    // Keep lightweight in-memory/test adapters compatible while production
    // repositories use the bounded SQL projection above.
    const { projects, environments, resources } =
      await findOrganizationResourceTopology(this.uow, input.organizationId);
    const environmentsByProject = new Map<string, typeof environments>();
    for (const environment of environments) {
      const projectEnvironments = environmentsByProject.get(
        environment.projectId,
      );
      if (projectEnvironments) projectEnvironments.push(environment);
      else environmentsByProject.set(environment.projectId, [environment]);
    }
    const resourcesByEnvironment = new Map<string, typeof resources>();
    for (const resource of resources) {
      const environmentResources = resourcesByEnvironment.get(
        resource.environmentId,
      );
      if (environmentResources) environmentResources.push(resource);
      else resourcesByEnvironment.set(resource.environmentId, [resource]);
    }
    const results: GlobalSearchResult[] = [];

    for (const project of projects) {
      if (project.name.toLowerCase().includes(query)) {
        results.push({
          type: "project",
          id: project.id,
          name: project.name,
          subtitle: "Project",
          href: `/projects/${project.id}`,
        });
      }
      for (const environment of environmentsByProject.get(project.id) ?? []) {
        if (environment.name.toLowerCase().includes(query)) {
          results.push({
            type: "environment",
            id: environment.id,
            name: environment.name,
            subtitle: project.name,
            href: `/projects/${project.id}/${environment.id}`,
          });
        }
        for (const resource of resourcesByEnvironment.get(environment.id) ??
          []) {
          if (
            resource.name.toLowerCase().includes(query) ||
            resource.appName?.toLowerCase().includes(query)
          ) {
            results.push({
              type: "resource",
              id: resource.id,
              name: resource.name,
              subtitle: `${project.name} / ${environment.name}`,
              href: `/projects/${project.id}/${environment.id}/${resource.id}`,
            });
          }
        }
      }
    }

    return results.slice(0, input.limit);
  }
}
