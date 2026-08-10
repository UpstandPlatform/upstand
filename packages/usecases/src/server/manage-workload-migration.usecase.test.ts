import { describe, expect, test } from "bun:test";
import type { IUnitOfWork, WorkloadMigration } from "@upstand/domain";
import { GetResourceWorkloadMigrationUseCase } from "./manage-workload-migration.usecase";

function createUnitOfWork(migrations: WorkloadMigration[] = []) {
  return {
    resourceRepository: {
      findById: async (id: string) =>
        id === "resource-1" ? { id, environmentId: "environment-1" } : null,
    },
    environmentRepository: {
      findById: async (id: string) =>
        id === "environment-1" ? { id, projectId: "project-1" } : null,
    },
    projectRepository: {
      findById: async (id: string) =>
        id === "project-1" ? { id, organizationId: "organization-1" } : null,
    },
    workloadMigrationRepository: {
      findByResourceId: async () => migrations,
    },
  } as unknown as IUnitOfWork;
}

describe("GetResourceWorkloadMigrationUseCase", () => {
  test("returns the latest migration supplied by the repository", async () => {
    const latest = {
      id: "migration-latest",
      resourceId: "resource-1",
      status: "validating",
    } as WorkloadMigration;
    const useCase = new GetResourceWorkloadMigrationUseCase(
      createUnitOfWork([
        latest,
        {
          id: "migration-older",
          resourceId: "resource-1",
          status: "completed",
        } as WorkloadMigration,
      ]),
    );

    await expect(
      useCase.execute({
        organizationId: "organization-1",
        resourceId: "resource-1",
      }),
    ).resolves.toEqual(latest);
  });

  test("does not disclose migrations across organizations", async () => {
    const useCase = new GetResourceWorkloadMigrationUseCase(createUnitOfWork());

    await expect(
      useCase.execute({
        organizationId: "organization-2",
        resourceId: "resource-1",
      }),
    ).rejects.toThrow("Resource not found");
  });
});
