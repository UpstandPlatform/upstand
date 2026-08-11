import { describe, expect, test } from "bun:test";
import { QueueDeploymentUseCase } from "./queue-deployment.usecase";

function resource(overrides: Record<string, unknown> = {}) {
  return {
    id: "resource-1",
    environmentId: "environment-1",
    name: "Test application",
    type: "application",
    status: "idle",
    provider: "github",
    appName: "test-application",
    dockerImage: null,
    credentials: JSON.stringify({}),
    buildConfig: "{}",
    advancedConfig: "{}",
    envVars: "{}",
    domains: "[]",
    serverId: null,
    buildServerId: null,
    ...overrides,
  };
}

describe("queue deployment", () => {
  test("rejects local deployment targets in cloud mode", async () => {
    const currentResource = resource({ type: "database", provider: "raw" });
    const uow = {
      transaction: async (callback: (tx: unknown) => unknown) =>
        await callback(uow),
      resourceRepository: {
        findById: async () => currentResource,
      },
    } as never;

    await expect(
      new QueueDeploymentUseCase(uow, undefined, "cloud").execute({
        resourceId: currentResource.id,
      }),
    ).rejects.toThrow("require a remote server");
  });

  test("rejects local build targets in cloud mode", async () => {
    const currentResource = resource({
      type: "database",
      provider: "raw",
      serverId: "remote-server",
      buildServerId: "local",
    });
    const uow = {
      transaction: async (callback: (tx: unknown) => unknown) =>
        await callback(uow),
      resourceRepository: {
        findById: async () => currentResource,
      },
    } as never;

    await expect(
      new QueueDeploymentUseCase(uow, undefined, "cloud").execute({
        resourceId: currentResource.id,
      }),
    ).rejects.toThrow("require a remote server");
  });

  test("rejects an unconfigured Git source before creating queue state", async () => {
    let deploymentCreates = 0;
    let outboxCreates = 0;
    const currentResource = resource();
    const uow = {
      transaction: async (callback: (tx: unknown) => unknown) =>
        await callback(uow),
      resourceRepository: {
        findById: async () => currentResource,
        create: async () => currentResource,
        updateById: async () => currentResource,
      },
      gitProviderRepository: {
        findById: async () => null,
      },
      deploymentRepository: {
        create: async () => {
          deploymentCreates += 1;
        },
      },
      outboxRepository: {
        create: async () => {
          outboxCreates += 1;
        },
      },
    } as never;

    await expect(
      new QueueDeploymentUseCase(uow).execute({
        resourceId: currentResource.id,
      }),
    ).rejects.toThrow(
      "Git provider is not associated. Configure a repository connection before deploying.",
    );
    expect(deploymentCreates).toBe(0);
    expect(outboxCreates).toBe(0);
  });
});
