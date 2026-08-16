import { describe, expect, test } from "bun:test";
import { ValidationError } from "@upstand/domain";
import { serializeResourceCredentials } from "./resource-credentials";
import {
  hasResourceCredentialReferences,
  validateResourceCredentialReferences,
} from "./validate-resource-credential-references";

const storedCredentials = (value: Record<string, unknown>) =>
  serializeResourceCredentials(JSON.stringify(value)) ?? "";

describe("resource credential references", () => {
  test("detects scoped provider and SSH-key references", () => {
    expect(
      hasResourceCredentialReferences(
        storedCredentials({ githubAccount: "provider-1" }),
      ),
    ).toBe(true);
    expect(
      hasResourceCredentialReferences(storedCredentials({ sshKeyId: "key-1" })),
    ).toBe(true);
    expect(
      hasResourceCredentialReferences(storedCredentials({ repository: "a/b" })),
    ).toBe(false);
  });

  test("accepts references owned by the resource organization", async () => {
    await expect(
      validateResourceCredentialReferences(
        {
          gitProviderRepository: {
            findById: async () => ({ organizationId: "org-1" }),
          },
          sshKeyRepository: {
            findById: async () => ({ organizationId: "org-1" }),
          },
        } as never,
        "org-1",
        storedCredentials({ githubAccount: "provider-1", sshKeyId: "key-1" }),
      ),
    ).resolves.toBeUndefined();
  });

  test("rejects references owned by another organization", async () => {
    await expect(
      validateResourceCredentialReferences(
        {
          gitProviderRepository: {
            findById: async () => ({ organizationId: "org-2" }),
          },
          sshKeyRepository: {
            findById: async () => ({ organizationId: "org-1" }),
          },
        } as never,
        "org-1",
        storedCredentials({ githubAccount: "provider-2" }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
