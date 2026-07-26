import { afterEach, describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import { CreateDockerRegistryUseCase } from "./create-docker-registry.usecase";

const keyName = "ENCRYPTION_KEY_V1";
const previousKey = process.env[keyName];

afterEach(() => {
  if (previousKey === undefined) delete process.env[keyName];
  else process.env[keyName] = previousKey;
});

describe("Docker registry credentials", () => {
  test("encrypts passwords before persistence", async () => {
    process.env[keyName] = Buffer.alloc(32, 7).toString("base64");
    let storedPassword: string | null | undefined;
    const useCase = new CreateDockerRegistryUseCase({
      transaction: async <T>(
        callback: (tx: IUnitOfWork) => Promise<T>,
      ): Promise<T> =>
        callback({
          dockerRegistryRepository: {
            create: async (input: { password?: string | null }) => {
              storedPassword = input.password;
              return { id: "registry-1" };
            },
          },
        } as unknown as IUnitOfWork),
    } as unknown as IUnitOfWork);

    await useCase.execute({
      organizationId: "org-1",
      name: "GHCR",
      password: "secret-token",
    });

    expect(storedPassword).toBeDefined();
    expect(storedPassword).not.toContain("secret-token");
    expect(decryptSecret(JSON.parse(String(storedPassword)))).toBe(
      "secret-token",
    );
  });
});
