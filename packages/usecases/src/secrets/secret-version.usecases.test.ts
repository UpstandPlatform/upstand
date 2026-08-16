import { describe, expect, test } from "bun:test";
import type { Resource } from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import { serializeResourceCredentials } from "../resource/resource-credentials";
import {
  parseResourceEnvironmentVariables,
  serializeResourceEnvironmentVariables,
} from "../resource/resource-environment";
import {
  RotateSecretsUseCase,
  RunDueSecretRotationsUseCase,
  SyncSecretProviderUseCase,
} from "./secret-version.usecases";

process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 11).toString("base64");

const resource: Resource = {
  id: "resource-1",
  environmentId: "environment-1",
  name: "Web",
  type: "application",
  status: "running",
  provider: "drop",
  appName: "web",
  credentials: serializeResourceCredentials("{}"),
  buildSecrets: null,
  buildConfig: "{}",
  advancedConfig: "{}",
  envVars: serializeResourceEnvironmentVariables({ KEEP: "old" }),
  domains: "[]",
  serverId: "local",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createUow() {
  let current = resource;
  const deployments: Record<string, unknown>[] = [];
  const outbox: Record<string, unknown>[] = [];
  const provider = {
    id: "provider-1",
    organizationId: "organization-1",
    name: "Vault",
    provider: "vault" as const,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const uow = {
    resourceRepository: {
      findById: async (id: string) => (id === current.id ? current : null),
      findByEnvironmentId: async (id: string) =>
        id === current.environmentId ? [current] : [],
      updateById: async (_id: string, patch: Partial<Resource>) => {
        current = { ...current, ...patch };
        return current;
      },
    },
    environmentRepository: {
      findById: async () => null,
    },
    projectRepository: {
      findById: async () => ({ organizationId: "organization-1" }),
    },
    serverRepository: { findById: async () => null },
    serverBuildSettingsRepository: {
      findById: async () => null,
      createIfNotExists: async () => undefined,
    },
    deploymentRepository: {
      create: async (input: Record<string, unknown>) => {
        deployments.push(input);
        return input;
      },
    },
    outboxRepository: {
      create: async (input: Record<string, unknown>) => {
        outbox.push(input);
        return input;
      },
    },
    secretProviderRepository: {
      findById: async (id: string) => (id === provider.id ? provider : null),
      findEnabledConfiguration: async (id: string, organizationId: string) =>
        id === provider.id &&
        organizationId === provider.organizationId &&
        provider.enabled
          ? {
              provider: provider.provider,
              encryptedConfiguration: JSON.stringify(
                encryptSecret(
                  JSON.stringify({ address: "https://vault.example" }),
                ),
              ),
            }
          : null,
    },
    transaction: async (work: (tx: never) => Promise<unknown>) =>
      work(uow as never),
  };

  return { uow, deployments, outbox, getResource: () => current };
}

describe("secret workflows", () => {
  test("rotates only requested keys, preserves unrelated values, and queues deployment", async () => {
    const { uow, deployments, outbox, getResource } = createUow();

    const result = await new RotateSecretsUseCase(uow as never).execute({
      scopeType: "resource",
      scopeId: resource.id,
      keys: ["API_TOKEN"],
      length: 16,
    });

    const values = parseResourceEnvironmentVariables(getResource().envVars);
    expect(result.rotatedKeys).toEqual(["API_TOKEN"]);
    expect(result.values.API_TOKEN).toHaveLength(16);
    expect(values).toMatchObject({
      KEEP: "old",
      API_TOKEN: result.values.API_TOKEN,
    });
    expect(deployments).toHaveLength(1);
    expect(deployments[0]).toMatchObject({
      title: "Rotate secrets",
      resourceId: resource.id,
    });
    expect(outbox).toHaveLength(1);
  });

  test("merges external secrets only for enabled providers and passes decrypted configuration", async () => {
    const { uow, deployments, getResource } = createUow();
    let receivedConfiguration: unknown;
    const external = {
      read: async (_provider: string, configuration: unknown) => {
        receivedConfiguration = configuration;
        return { FROM_VAULT: "new", KEEP: "overridden" };
      },
    };

    const result = await new SyncSecretProviderUseCase(
      uow as never,
      external,
    ).execute({
      providerId: "provider-1",
      organizationId: "organization-1",
      scopeType: "resource",
      scopeId: resource.id,
      merge: true,
    });

    expect(receivedConfiguration).toEqual({ address: "https://vault.example" });
    expect(result).toEqual({ syncedKeys: ["FROM_VAULT", "KEEP"] });
    expect(parseResourceEnvironmentVariables(getResource().envVars)).toEqual({
      KEEP: "overridden",
      FROM_VAULT: "new",
    });
    expect(deployments).toHaveLength(1);
  });

  test("does not call an external provider when it is disabled", async () => {
    const { uow } = createUow();
    (uow.secretProviderRepository
      .findEnabledConfiguration as unknown as () => Promise<unknown>) =
      async () => null;
    let calls = 0;
    const external = {
      read: async () => {
        calls += 1;
        return {};
      },
    };

    await expect(
      new SyncSecretProviderUseCase(uow as never, external).execute({
        providerId: "provider-1",
        organizationId: "organization-1",
        scopeType: "resource",
        scopeId: resource.id,
        merge: true,
      }),
    ).rejects.toThrow("Secret provider not found or disabled");
    expect(calls).toBe(0);
  });

  test("does not read a provider owned by another organization", async () => {
    const { uow } = createUow();
    let calls = 0;
    const external = {
      read: async () => {
        calls += 1;
        return {};
      },
    };

    await expect(
      new SyncSecretProviderUseCase(uow as never, external).execute({
        providerId: "provider-1",
        organizationId: "organization-2",
        scopeType: "resource",
        scopeId: resource.id,
        merge: true,
      }),
    ).rejects.toThrow("Secret provider not found or disabled");
    expect(calls).toBe(0);
  });

  test("releases failed claims and continues rotating unrelated due schedules", async () => {
    const { uow, deployments, getResource } = createUow();
    const now = new Date("2026-07-22T12:00:00.000Z");
    const failedScopeSchedule = {
      id: "schedule-missing",
      scopeType: "resource" as const,
      scopeId: "deleted-resource",
      keys: ["MISSING"],
      valueLength: 16,
    };
    const validSchedule = {
      id: "schedule-valid",
      scopeType: "resource" as const,
      scopeId: resource.id,
      keys: ["ROTATED"],
      valueLength: 16,
    };
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const scheduleRepository = {
      findDue: async () => [failedScopeSchedule, validSchedule],
      claimDue: async (id: string) =>
        id === failedScopeSchedule.id ? failedScopeSchedule : validSchedule,
      updateById: async (id: string, patch: Record<string, unknown>) => {
        updates.push({ id, patch });
        return null;
      },
    };
    const uowWithSchedule = uow as typeof uow & {
      secretRotationScheduleRepository: typeof scheduleRepository;
    };
    uowWithSchedule.secretRotationScheduleRepository = scheduleRepository;

    const rotated = await new RunDueSecretRotationsUseCase(
      uowWithSchedule as never,
    ).execute(now);

    expect(rotated).toBe(1);
    expect(updates).toContainEqual({
      id: failedScopeSchedule.id,
      patch: { rotationClaimedUntil: null },
    });
    expect(updates).toContainEqual({
      id: validSchedule.id,
      patch: { lastRotatedAt: now, rotationClaimedUntil: null },
    });
    expect(
      parseResourceEnvironmentVariables(getResource().envVars),
    ).toHaveProperty("ROTATED");
    expect(deployments).toHaveLength(1);
    expect(deployments[0]).toMatchObject({
      title: "Automatic secret rotation",
      resourceId: resource.id,
    });
  });
});
