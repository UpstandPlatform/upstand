import { describe, expect, test } from "bun:test";
import { mockUnitOfWork } from "../testing/mock-unit-of-work";
import { GetDeploymentServerSettingsUseCase } from "./get-deployment-server-settings.usecase";

const swarmNodes = [
  {
    id: "local-node",
    hostname: "cloud-manager",
    ip: "127.0.0.1",
    isLeader: true,
  },
];

describe("GetDeploymentServerSettingsUseCase", () => {
  test("returns only remote build servers when local runtime is unavailable", async () => {
    const useCase = new GetDeploymentServerSettingsUseCase(
      mockUnitOfWork({
        serverBuildSettingsRepository: {
          findMany: async () => [],
        },
        serverRepository: {
          findByOrganizationId: async () => [
            {
              id: "remote-build",
              name: "Build server",
              ipAddress: "192.0.2.10",
              status: "ready",
              serverType: "deploy",
            },
            {
              id: "remote-database",
              name: "Database server",
              ipAddress: "192.0.2.11",
              status: "ready",
              serverType: "database",
            },
          ],
        },
      }),
      { listSwarmNodes: async () => swarmNodes },
    );

    await expect(
      useCase.execute("organization-1", { includeLocal: false }),
    ).resolves.toEqual([
      {
        id: "remote-build",
        hostname: "Build server",
        ip: "192.0.2.10",
        concurrency: 1,
        status: "ready",
        serverType: "deploy",
      },
    ]);
  });
});
