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
        organizationId: "org-1",
        name: "Test App",
        serverId: "server-source",
        status: "running",
      } as unknown as Resource,
    ],
  ]);

  const deployments = new Map<string, Deployment>();
  const outbox = new Map<string, Record<string, unknown>>();

  const uow = {
    transaction: async <T>(fn: (tx: IUnitOfWork) => Promise<T>): Promise<T> =>
      fn(uow as unknown as IUnitOfWork),
    serverRepository: {
      findById: async (id: string) => servers.get(id) ?? null,
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
        resourceId: "res-1",
        targetServerId: "server-source",
      }),
    ).rejects.toThrow("Resource is already placed on the target server");
  });
});
