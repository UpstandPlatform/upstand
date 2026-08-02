import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { findOrganizationResourceIds } from "./organization-resources.helper";

describe("organization resource traversal", () => {
  test("uses the tenant-scoped SQL resource projection when available", async () => {
    let projectReads = 0;
    const uow = {
      projectRepository: {
        findByOrganizationId: async () => {
          projectReads += 1;
          return [];
        },
      },
      resourceRepository: {
        findIdsByOrganizationId: async (organizationId: string) => {
          expect(organizationId).toBe("org-1");
          return ["resource-1", "resource-2"];
        },
      },
    } as unknown as IUnitOfWork;

    await expect(findOrganizationResourceIds(uow, "org-1")).resolves.toEqual([
      "resource-1",
      "resource-2",
    ]);
    expect(projectReads).toBe(0);
  });

  test("uses ID-only repository projections for organization scoping", async () => {
    let hydratedEnvironmentReads = 0;
    let hydratedResourceReads = 0;
    const uow = {
      projectRepository: {
        findByOrganizationId: async () => [{ id: "project-1" }],
      },
      environmentRepository: {
        findIdsByProjectId: async () => ["environment-1"],
        findByProjectId: async () => {
          hydratedEnvironmentReads += 1;
          return [];
        },
      },
      resourceRepository: {
        findIdsByEnvironmentId: async () => ["resource-1"],
        findByEnvironmentId: async () => {
          hydratedResourceReads += 1;
          return [];
        },
      },
    } as unknown as IUnitOfWork;

    await expect(findOrganizationResourceIds(uow, "org-1")).resolves.toEqual([
      "resource-1",
    ]);
    expect(hydratedEnvironmentReads).toBe(0);
    expect(hydratedResourceReads).toBe(0);
  });

  test("loads project environments and resources with bounded parallelism", async () => {
    let activeEnvironmentReads = 0;
    let maxEnvironmentReads = 0;
    let activeResourceReads = 0;
    let maxResourceReads = 0;

    const uow = {
      projectRepository: {
        findByOrganizationId: async () =>
          Array.from({ length: 40 }, (_, index) => ({
            id: `project-${index}`,
          })),
      },
      environmentRepository: {
        findByProjectId: async (projectId: string) => {
          activeEnvironmentReads += 1;
          maxEnvironmentReads = Math.max(
            maxEnvironmentReads,
            activeEnvironmentReads,
          );
          await Bun.sleep(1);
          activeEnvironmentReads -= 1;
          return [{ id: `environment-${projectId}` }];
        },
      },
      resourceRepository: {
        findByEnvironmentId: async (environmentId: string) => {
          activeResourceReads += 1;
          maxResourceReads = Math.max(maxResourceReads, activeResourceReads);
          await Bun.sleep(1);
          activeResourceReads -= 1;
          return [{ id: `resource-${environmentId}` }];
        },
      },
    } as unknown as IUnitOfWork;

    const resourceIds = await findOrganizationResourceIds(uow, "org-1");

    expect(resourceIds).toHaveLength(40);
    expect(new Set(resourceIds).size).toBe(40);
    expect(maxEnvironmentReads).toBeLessThanOrEqual(16);
    expect(maxResourceReads).toBeLessThanOrEqual(16);
  });
});
