import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { generateEd25519KeyPair } from "@upstand/platform/ssh/keygen";
import { GetSshKeysUseCase } from "./get-ssh-keys.usecase";
import { UpdateSshKeyUseCase } from "./update-ssh-key.usecase";

const TEST_KEY = Buffer.alloc(32, 17).toString("base64");
process.env.ENCRYPTION_KEY_V1 ??= TEST_KEY;

function makeKey() {
  const pair = generateEd25519KeyPair("test-key");
  return {
    id: "key-1",
    organizationId: "org-1",
    name: "Production",
    description: null,
    algorithm: "ed25519" as const,
    publicKey: pair.publicKey,
    fingerprint: pair.fingerprint,
    privateKeyCiphertext: "ciphertext",
    privateKeyIv: "iv",
    privateKeyAuthTag: "auth-tag",
    privateKeyVersion: 1,
    createdBy: "user-1",
    createdAt: new Date(),
  };
}

describe("SSH key lifecycle", () => {
  test("rotates a key pair and encrypts the replacement private key", async () => {
    const current = makeKey();
    const { privateKey, publicKey, fingerprint } =
      generateEd25519KeyPair("replacement");
    let patch: Record<string, unknown> | undefined;
    const uow = {
      transaction: async (work: (tx: never) => Promise<unknown>) =>
        work({
          sshKeyRepository: {
            findById: async () => current,
            updateById: async (_id: string, input: Record<string, unknown>) => {
              patch = input;
              return { ...current, ...input };
            },
          },
        } as never),
    };

    const result = await new UpdateSshKeyUseCase(
      uow as unknown as IUnitOfWork,
    ).execute({
      id: current.id,
      organizationId: current.organizationId,
      privateKey,
      publicKey,
    });

    expect(patch).toMatchObject({
      algorithm: "ed25519",
      publicKey,
      fingerprint,
    });
    expect(patch?.privateKeyCiphertext).toBeString();
    expect(patch?.privateKeyCiphertext).not.toBe(privateKey);
    expect(result).not.toHaveProperty("privateKeyCiphertext");
    expect(result.publicKey).toBe(publicKey);
  });

  test("requires both halves of a rotated key pair", async () => {
    await expect(
      new UpdateSshKeyUseCase({} as unknown as IUnitOfWork).execute({
        id: "key-1",
        organizationId: "org-1",
        publicKey: "ssh-ed25519 invalid",
      }),
    ).rejects.toThrow("rotated together");
  });

  test("redacts encrypted material from organization list responses", async () => {
    const key = makeKey();
    const uow = {
      transaction: async (work: (tx: never) => Promise<unknown>) =>
        work({
          sshKeyRepository: {
            findByOrganizationId: async () => [key],
          },
        } as never),
    };

    const [view] = await new GetSshKeysUseCase(
      uow as unknown as IUnitOfWork,
    ).execute({
      organizationId: "org-1",
    });
    expect(view).toMatchObject({ id: key.id, publicKey: key.publicKey });
    expect(view).not.toHaveProperty("privateKeyCiphertext");
    expect(view).not.toHaveProperty("privateKeyIv");
    expect(view).not.toHaveProperty("privateKeyAuthTag");
  });
});
