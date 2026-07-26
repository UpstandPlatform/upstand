import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";

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
    const projects = await this.uow.projectRepository.findByOrganizationId(
      input.organizationId,
    );
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
      const environments = await this.uow.environmentRepository.findByProjectId(
        project.id,
      );
      for (const environment of environments) {
        if (environment.name.toLowerCase().includes(query)) {
          results.push({
            type: "environment",
            id: environment.id,
            name: environment.name,
            subtitle: project.name,
            href: `/projects/${project.id}/${environment.id}`,
          });
        }
        const resources = await this.uow.resourceRepository.findByEnvironmentId(
          environment.id,
        );
        for (const resource of resources) {
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
