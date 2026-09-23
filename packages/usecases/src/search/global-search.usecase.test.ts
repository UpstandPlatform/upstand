import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { GlobalSearchUseCase } from "./global-search.usecase";

describe("GlobalSearchUseCase", () => {
  test("uses the bounded repository projection when available", async () => {
    let topologyRead = false;
    const uow = {
      projectRepository: {
        searchByOrganizationId: async () => [
          {
            type: "resource" as const,
            id: "resource-1",
            name: "Checkout API",
            projectId: "project-1",
            projectName: "Payments",
            environmentId: "environment-1",
            environmentName: "Production",
          },
        ],
      },
      environmentRepository: {
        findByProjectId: async () => {
          topologyRead = true;
          return [];
        },
      },
      resourceRepository: {
        findByEnvironmentId: async () => {
          topologyRead = true;
          return [];
        },
      },
    } as unknown as IUnitOfWork;

    await expect(
      new GlobalSearchUseCase(uow).execute({
        organizationId: "org-1",
        query: "api",
        limit: 20,
      }),
    ).resolves.toEqual([
      {
        type: "resource",
        id: "resource-1",
        name: "Checkout API",
        subtitle: "Payments / Production",
        href: "/projects/project-1/environment-1/resource-1",
      },
    ]);
    expect(topologyRead).toBe(false);
  });

  test("returns project, environment, and resource matches from one bounded topology read", async () => {
    const uow = {
      projectRepository: {
        findByOrganizationId: async () => [
          { id: "project-1", name: "Payments" },
        ],
      },
      environmentRepository: {
        findByProjectId: async () => [
          { id: "environment-1", projectId: "project-1", name: "Production" },
        ],
      },
      resourceRepository: {
        findByEnvironmentId: async () => [
          {
            id: "resource-1",
            environmentId: "environment-1",
            name: "Checkout API",
            appName: "checkout-api",
          },
        ],
      },
    } as unknown as IUnitOfWork;

    const results = await new GlobalSearchUseCase(uow).execute({
      organizationId: "org-1",
      query: "api",
      limit: 20,
    });

    expect(results).toEqual([
      {
        type: "resource",
        id: "resource-1",
        name: "Checkout API",
        subtitle: "Payments / Production",
        href: "/projects/project-1/environment-1/resource-1",
      },
    ]);
  });

  test("calls the repository projection with its own receiver", async () => {
    // The production repository is a class whose query methods read
    // `this.executor`. A detached method reference type-checks but throws at
    // runtime, so the double here must be a real class method, not a closure.
    class ProjectRepositoryDouble {
      private readonly executor = { organizationId: "org-1" };

      async searchByOrganizationId(organizationId: string) {
        if (this.executor.organizationId !== organizationId) {
          throw new Error("unexpected organization");
        }
        return [
          {
            type: "project" as const,
            id: "project-1",
            name: "Payments",
          },
        ];
      }
    }

    const uow = {
      projectRepository: new ProjectRepositoryDouble(),
    } as unknown as IUnitOfWork;

    await expect(
      new GlobalSearchUseCase(uow).execute({
        organizationId: "org-1",
        query: "pay",
        limit: 20,
      }),
    ).resolves.toEqual([
      {
        type: "project",
        id: "project-1",
        name: "Payments",
        subtitle: "Project",
        href: "/projects/project-1",
      },
    ]);
  });
});
