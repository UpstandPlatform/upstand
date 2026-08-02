import { describe, expect, test } from "bun:test";
import type {
  Deployment,
  IUnitOfWork,
  Resource,
  Server,
} from "@upstand/domain";
import { MigrateResourceUseCase } from "./migrate-resource.usecase";

function createMigrateTestUow() {
  const servers = new Map<string, Server>([
    [
      "server-source",
      {
        id: "server-source",
        organizationId: "org-1",
        name: "Source Node",
        status: "ready",
      } as unknown as Server,
    ],
    [
      "server-target",
      {
        id: "server-target",
        organizationId: "org-1",
        name: "Target Node",
        status: "ready",
      } as unknown as Server,
    ],
  ]);

  const resources = new Map<string, Resource>([
    [
      "res-1",
      {
        id: "res-1",
        environmentId: "env-1",
        organizationId: "org-1",
        name: "Test App",
        serverId: "server-source",
        status: "running",
      } as unknown as Resource,
    ],
  ]);

  const deployments = new Map<string, Deployment>();
  const outbox = new Map<string, Record<string, unknown>>();
  const environments = new Map([
    ["env-1", { id: "env-1", projectId: "project-1" }],
    ["env-2", { id: "env-2", projectId: "project-2" }],
  ]);
  const projects = new Map([
    ["project-1", { id: "project-1", organizationId: "org-1" }],
    ["project-2", { id: "project-2", organizationId: "org-2" }],
  ]);

  const uow = {
    transaction: async <T>(fn: (tx: IUnitOfWork) => Promise<T>): Promise<T> =>
      fn(uow as unknown as IUnitOfWork),
    serverRepository: {
      findById: async (id: string) => servers.get(id) ?? null,
    },
    environmentRepository: {
      findById: async (id: string) => environments.get(id) ?? null,
    },
    projectRepository: {
      findById: async (id: string) => projects.get(id) ?? null,
    },
    resourceRepository: {
      findById: async (id: string) => resources.get(id) ?? null,
      updateById: async (id: string, patch: Partial<Resource>) => {
        const res = resources.get(id);
        if (!res) return null;
        Object.assign(res, patch);
        return res;
      },
    },
    deploymentRepository: {
      create: async (data: Partial<Deployment>) => {
        const id = data.id ?? `dep-${deployments.size + 1}`;
        const deployment = {
          id,
          resourceId: data.resourceId,
          title: data.title,
          status: data.status,
          sourceRevision: data.sourceRevision,
          logs: data.logs,
        } as Deployment;
        deployments.set(id, deployment);
        return deployment;
      },
    },
    outboxRepository: {
      create: async (data: Record<string, unknown>) => {
        outbox.set(data.id as string, data);
        return data;
      },
    },
  } as unknown as IUnitOfWork;

  return { uow, servers, resources, deployments, outbox };
}

describe("MigrateResourceUseCase", () => {
  test("migrates resource from source server to target server", async () => {
    const { uow, resources, deployments, outbox } = createMigrateTestUow();

    const useCase = new MigrateResourceUseCase(uow);
    const result = await useCase.execute({
      organizationId: "org-1",
      resourceId: "res-1",
      targetServerId: "server-target",
    });

    expect(result).toBeDefined();
    expect(result.sourceServerId).toBe("server-source");
    expect(result.targetServer.id).toBe("server-target");
    expect(resources.get("res-1")?.serverId).toBe("server-target");
    expect(deployments.size).toBe(1);
    expect(outbox.size).toBe(1);
  });

  test("throws when resource is already placed on target server", async () => {
    const { uow } = createMigrateTestUow();

    const useCase = new MigrateResourceUseCase(uow);
    await expect(
      useCase.execute({
        organizationId: "org-1",
        resourceId: "res-1",
        targetServerId: "server-source",
      }),
    ).rejects.toThrow("Resource is already placed on the target server");
  });

  test("rejects a resource owned by another organization", async () => {
    const { uow, resources, deployments, outbox } = createMigrateTestUow();
    resources.set("res-other-org", {
      id: "res-other-org",
      environmentId: "env-2",
      organizationId: "org-2",
      name: "Other App",
      serverId: "server-source",
      status: "running",
    } as unknown as Resource);

    const useCase = new MigrateResourceUseCase(uow);
    await expect(
      useCase.execute({
        organizationId: "org-1",
        resourceId: "res-other-org",
        targetServerId: "server-target",
      }),
    ).rejects.toThrow("Resource not found");
    expect(resources.get("res-other-org")?.serverId).toBe("server-source");
    expect(deployments.size).toBe(0);
    expect(outbox.size).toBe(0);
  });

  test("rejects a target server owned by another organization", async () => {
    const { uow, servers, resources, deployments, outbox } =
      createMigrateTestUow();
    servers.set("server-other-org", {
      id: "server-other-org",
      organizationId: "org-2",
      name: "Other Node",
      status: "ready",
    } as unknown as Server);

    const useCase = new MigrateResourceUseCase(uow);
    await expect(
      useCase.execute({
        organizationId: "org-1",
        resourceId: "res-1",
        targetServerId: "server-other-org",
      }),
    ).rejects.toThrow("Target server not found");
    expect(resources.get("res-1")?.serverId).toBe("server-source");
    expect(deployments.size).toBe(0);
    expect(outbox.size).toBe(0);
  });
});
