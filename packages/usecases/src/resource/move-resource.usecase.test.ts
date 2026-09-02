import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { MoveResourceUseCase } from "./move-resource.usecase";

function makeUow(overrides: Record<string, unknown> = {}) {
  const increments: Array<[string, number]> = [];
  const resource = {
    id: "resource-1",
    environmentId: "source-env",
    serverId: null,
    buildServerId: null,
    buildRegistryId: null,
    rollbackRegistryId: null,
    rollbackActive: false,
    credentials: null,
    domains: "[]",
    name: "API",
    type: "application",
  };
  const uow = {
    transaction: async <T>(callback: (tx: IUnitOfWork) => Promise<T>) =>
      callback(uow as unknown as IUnitOfWork),
    resourceRepository: {
      lockById: async () => true,
      findById: async () => resource,
      updateById: async (_id: string, patch: Record<string, unknown>) => ({
        ...resource,
        ...patch,
      }),
    },
    environmentRepository: {
      findById: async (id: string) =>
        id === "source-env"
          ? { id, projectId: "source-project" }
          : { id, projectId: "target-project" },
      incrementResourceCount: async (id: string, delta: number) => {
        increments.push([id, delta]);
      },
    },
    projectRepository: {
      findById: async (id: string) =>
        id === "source-project"
          ? { id, organizationId: "source-org", archivedAt: null }
          : { id, organizationId: "target-org", archivedAt: null },
    },
    serverRepository: { findById: async () => null },
    dockerRegistryRepository: { findById: async () => null },
    gitProviderRepository: { findById: async () => null },
    sshKeyRepository: { findById: async () => null },
    certificateRepository: { findById: async () => null },
    workloadMigrationRepository: { findByResourceId: async () => [] },
    ...overrides,
  } as unknown as IUnitOfWork & { increments: Array<[string, number]> };
  uow.increments = increments;
  return uow;
}

describe("MoveResourceUseCase", () => {
  test("moves a resource atomically and updates both environment counters", async () => {
    const uow = makeUow();
    const result = await new MoveResourceUseCase(uow).execute({
      resourceId: "resource-1",
      sourceOrganizationId: "source-org",
      targetProjectId: "target-project",
      targetEnvironmentId: "target-env",
    });

    expect(result.resource.environmentId).toBe("target-env");
    expect(uow.increments).toEqual([
      ["source-env", -1],
      ["target-env", 1],
    ]);
  });

  test("requires explicit target mappings for cross-organization references", async () => {
    const uow = makeUow({
      resourceRepository: {
        lockById: async () => true,
        findById: async () => ({
          id: "resource-1",
          environmentId: "source-env",
          serverId: "source-server",
          buildServerId: null,
          buildRegistryId: "source-registry",
          rollbackRegistryId: null,
          credentials: null,
          domains: "[]",
        }),
      },
    });

    await expect(
      new MoveResourceUseCase(uow).execute({
        resourceId: "resource-1",
        sourceOrganizationId: "source-org",
        targetProjectId: "target-project",
        targetEnvironmentId: "target-env",
      }),
    ).rejects.toThrow("Deployment server must be mapped");
  });

  test("preserves the local deployment sentinel across organizations", async () => {
    const resource = {
      id: "resource-1",
      environmentId: "source-env",
      serverId: "local",
      buildServerId: null,
      buildRegistryId: null,
      rollbackRegistryId: null,
      rollbackActive: false,
      credentials: null,
      domains: "[]",
      name: "API",
      type: "application",
    };
    const uow = makeUow({
      resourceRepository: {
        lockById: async () => true,
        findById: async () => resource,
        updateById: async (_id: string, patch: Record<string, unknown>) => ({
          ...resource,
          ...patch,
        }),
      },
    });
    const result = await new MoveResourceUseCase(uow).execute({
      resourceId: resource.id,
      sourceOrganizationId: "source-org",
      targetProjectId: "target-project",
      targetEnvironmentId: "target-env",
    });

    expect(result.resource.serverId).toBe("local");
  });
});
