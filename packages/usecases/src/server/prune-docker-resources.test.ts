import { describe, expect, mock, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import type { DockerPrunePort } from "../ports/docker";
import { PruneDockerResourcesUseCase } from "./prune-docker-resources.usecase";

const keyName = "ENCRYPTION_KEY_V1";
process.env[keyName] ??= Buffer.alloc(32, 7).toString("base64");

interface RepositoryItem {
  id: string;
  organizationId?: string;
}

function createMockUow(
  server: RepositoryItem | null,
  sshKey: RepositoryItem | null,
): IUnitOfWork {
  return {
    serverRepository: {
      findById: async (id: string) => (id === server?.id ? server : null),
    },
    sshKeyRepository: {
      findById: async (id: string) => (id === sshKey?.id ? sshKey : null),
    },
  } as unknown as IUnitOfWork;
}

describe("PruneDockerResourcesUseCase", () => {
  test("successfully prunes local docker resources", async () => {
    const prune = mock(() =>
      Promise.resolve({ success: true as const, output: ["images: pruned"] }),
    );
    const mockDockerService: DockerPrunePort = { prune };
    const uow = createMockUow(null, null);

    const useCase = new PruneDockerResourcesUseCase(uow, mockDockerService);
    const result = await useCase.execute({
      organizationId: "org-1",
      serverId: "local",
      type: "images",
    });

    expect(result.success).toBeTrue();
    expect(result.output).toEqual(["images: pruned"]);
    expect(prune).toHaveBeenCalledWith(
      { kind: "local", name: "Local Docker" },
      "images",
      { preserveRollbackImages: true, pruneNetworks: false },
    );
  });

  test("successfully prunes remote docker resources", async () => {
    const encrypted = encryptSecret("remote-private-key");
    const server = {
      id: "server-1",
      organizationId: "org-1",
      name: "Remote Server",
      sshKeyId: "key-1",
      ipAddress: "192.168.1.1",
      port: 22,
      username: "root",
    };
    const sshKey = {
      id: "key-1",
      privateKeyCiphertext: encrypted.ciphertext,
      privateKeyIv: encrypted.iv,
      privateKeyAuthTag: encrypted.authTag,
      privateKeyVersion: encrypted.keyVersion,
    };

    const prune = mock(() =>
      Promise.resolve({ success: true as const, output: ["volumes: pruned"] }),
    );
    const mockDockerService: DockerPrunePort = { prune };
    const uow = createMockUow(server, sshKey);

    const useCase = new PruneDockerResourcesUseCase(uow, mockDockerService);
    const result = await useCase.execute({
      organizationId: "org-1",
      serverId: "server-1",
      type: "volumes",
    });

    expect(result.success).toBeTrue();
    expect(result.output).toEqual(["volumes: pruned"]);
    expect(prune).toHaveBeenCalledWith(
      {
        kind: "remote",
        name: "Remote Server",
        host: "192.168.1.1",
        port: 22,
        username: "root",
        privateKey: "remote-private-key",
      },
      "volumes",
      { preserveRollbackImages: true, pruneNetworks: false },
    );
  });

  test("rejects server from another organization", async () => {
    const server = {
      id: "server-1",
      organizationId: "org-different",
      name: "Remote Server",
      sshKeyId: "key-1",
    };
    const uow = createMockUow(server, null);
    const mockDockerService: DockerPrunePort = {
      prune: mock(() =>
        Promise.resolve({ success: true as const, output: [] as string[] }),
      ),
    };

    const useCase = new PruneDockerResourcesUseCase(uow, mockDockerService);
    await expect(
      useCase.execute({
        organizationId: "org-1",
        serverId: "server-1",
        type: "all",
      }),
    ).rejects.toThrow("Server is not part of the active organization.");
  });
});
