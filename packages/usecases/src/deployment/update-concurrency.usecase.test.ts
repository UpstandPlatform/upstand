import { describe, expect, test } from "bun:test";
import type { CreateServerBuildSettingsDTO } from "@upstand/domain";
import { mockUnitOfWork } from "../testing/mock-unit-of-work";
import { UpdateConcurrencyUseCase } from "./update-concurrency.usecase";

const noSwarmNodes = {
  listSwarmNodes: async () => [],
};

const mockRedisPublisher = {
  publish: async () => 1,
};

describe("UpdateConcurrencyUseCase", () => {
  test("rejects a build-server setting outside the active organization", async () => {
    const useCase = new UpdateConcurrencyUseCase(
      mockUnitOfWork({
        serverRepository: {
          findById: async () => ({ organizationId: "different-org" }),
        },
      }),
      noSwarmNodes,
      mockRedisPublisher,
    );

    await expect(
      useCase.execute({
        organizationId: "active-org",
        serverId: "remote-server",
        concurrency: 2,
      }),
    ).rejects.toThrow("not part of the active organization");
  });

  test("rejects database servers as build-concurrency targets", async () => {
    const useCase = new UpdateConcurrencyUseCase(
      mockUnitOfWork({
        serverRepository: {
          findById: async () => ({
            organizationId: "active-org",
            serverType: "database",
          }),
        },
      }),
      noSwarmNodes,
      mockRedisPublisher,
    );

    await expect(
      useCase.execute({
        organizationId: "active-org",
        serverId: "database-server",
        concurrency: 2,
      }),
    ).rejects.toThrow("Database servers cannot be used");
  });

  test("updates settings for a local Docker Swarm node", async () => {
    const now = new Date();
    const useCase = new UpdateConcurrencyUseCase(
      mockUnitOfWork({
        serverRepository: {
          findById: async () => undefined,
        },
        serverBuildSettingsRepository: {
          findById: async () => null,
          findMany: async () => [],
          create: async (data: CreateServerBuildSettingsDTO) => ({
            id: data.id,
            hostname: data.hostname,
            ip: data.ip,
            concurrency: data.concurrency ?? 1,
            createdAt: now,
            updatedAt: now,
          }),
          createIfNotExists: async () => null,
          updateById: async () => null,
          deleteById: async () => true,
        },
      }),
      {
        listSwarmNodes: async () => [
          {
            id: "local-swarm-node",
            hostname: "docker-desktop",
            ip: "127.0.0.1",
            isLeader: true,
          },
        ],
      },
      mockRedisPublisher,
    );

    const settings = await useCase.execute({
      organizationId: "active-org",
      serverId: "local-swarm-node",
      concurrency: 3,
      hostname: "docker-desktop",
      ip: "127.0.0.1",
    });

    expect(settings).toMatchObject({
      id: "local-swarm-node",
      concurrency: 3,
    });
  });
});
