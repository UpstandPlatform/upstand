import { describe, expect, test } from "bun:test";
import { serializeResourceCredentials } from "../resource/resource-credentials";
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

  test("puts a signed resource grant on deployment outbox jobs", async () => {
    const previousScopeSecret = process.env.UPSTAND_DOCKER_BROKER_SCOPE_SECRET;
    process.env.UPSTAND_DOCKER_BROKER_SCOPE_SECRET = "s".repeat(32);
    const currentResource = resource({
      type: "compose",
      provider: "raw",
      credentials: serializeResourceCredentials({
        composeFile: "services:\n  app:\n    image: alpine",
      }),
      serverId: "server-1",
    });
    let outboxPayload: Record<string, unknown> | undefined;
    const updatedResource = { ...currentResource, status: "queued" };
    const uow = {
      transaction: async (callback: (tx: unknown) => unknown) =>
        await callback(uow),
      resourceRepository: {
        findById: async () => currentResource,
        updateById: async () => updatedResource,
      },
      environmentRepository: { findById: async () => null },
      serverRepository: {
        findById: async () => ({
          name: "Deployment server",
          ipAddress: "203.0.113.10",
          status: "ready",
          authType: "ssh-key",
          sshKeyId: "key-1",
        }),
      },
      serverBuildSettingsRepository: {
        findById: async () => null,
        createIfNotExists: async () => undefined,
      },
      deploymentRepository: { create: async () => undefined },
      outboxRepository: {
        create: async ({ payload }: { payload: Record<string, unknown> }) => {
          outboxPayload = payload;
        },
      },
    } as never;

    try {
      await new QueueDeploymentUseCase(uow).execute({
        resourceId: currentResource.id,
        deploymentId: "deployment-1",
      });
      expect(outboxPayload?.resourceId).toBe(currentResource.id);
      expect(outboxPayload?.dockerScopeToken).toMatch(
        /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
      );
    } finally {
      if (previousScopeSecret === undefined) {
        delete process.env.UPSTAND_DOCKER_BROKER_SCOPE_SECRET;
      } else {
        process.env.UPSTAND_DOCKER_BROKER_SCOPE_SECRET = previousScopeSecret;
      }
    }
  });
});
