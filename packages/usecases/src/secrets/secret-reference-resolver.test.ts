import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import type { ExternalSecretProviderPort } from "../ports/external-secrets";
import {
  resolveSecretProviderReferences,
  resolveSecretProviderReferencesInValues,
} from "./secret-reference-resolver";

function createScope() {
  return {
    organizationId: "org-1",
    projectId: "project-1",
    environmentId: "environment-1",
  };
}

function createUnitOfWork(assignments?: unknown): IUnitOfWork {
  const encryptedConfiguration = encryptSecret(
    JSON.stringify({
      providerType: "doppler",
      project: "production",
      config: "prd",
      token: "provider-token",
      ...(assignments === undefined
        ? {}
        : { __upstandAssignments: assignments }),
    }),
  );
  return {
    secretProviderRepository: {
      findEnabledConfigurationsByOrganizationId: async () => [
        {
          id: "provider-1",
          name: "production-doppler",
          provider: "doppler",
          encryptedConfiguration: JSON.stringify(encryptedConfiguration),
        },
      ],
    },
  } as unknown as IUnitOfWork;
}

describe("secret provider reference resolution", () => {
  test("resolves Dokploy-compatible references without persisting values", async () => {
    const external: ExternalSecretProviderPort = {
      read: async () => ({}),
      readReferences: async (
        provider: string,
        configuration: Record<string, string>,
        references: string[],
      ) => {
        expect(provider).toBe("doppler");
        expect(configuration.token).toBe("provider-token");
        expect(references).toEqual(["DATABASE_URL"]);
        return { DATABASE_URL: "postgres://secret" };
      },
    };

    const values = await resolveSecretProviderReferencesInValues(
      { DATABASE_URL: "$" + "{{vault.production-doppler.DATABASE_URL}}" },
      createUnitOfWork(),
      external,
      createScope(),
    );

    expect(values).toEqual({ DATABASE_URL: "postgres://secret" });
  });

  test("rejects a provider that is explicitly assigned elsewhere", async () => {
    const external: ExternalSecretProviderPort = {
      read: async () => ({}),
      readReferences: async () => ({ API_KEY: "should-not-be-read" }),
    };

    await expect(
      resolveSecretProviderReferences(
        "$" + "{{vault.production-doppler.API_KEY}}",
        createUnitOfWork([
          { projectId: "another-project", environmentIds: [] },
        ]),
        external,
        createScope(),
      ),
    ).rejects.toThrow("not enabled for this project/environment");
  });

  test("fails closed when a referenced provider is missing", async () => {
    const unitOfWork = createUnitOfWork();
    unitOfWork.secretProviderRepository.findEnabledConfigurationsByOrganizationId =
      async () => [];

    await expect(
      resolveSecretProviderReferences(
        "$" + "{{vault.missing-provider.API_KEY}}",
        unitOfWork,
        { read: async () => ({}), readReferences: async () => ({}) },
        createScope(),
      ),
    ).rejects.toThrow('Secret provider "missing-provider" not found');
  });
});
