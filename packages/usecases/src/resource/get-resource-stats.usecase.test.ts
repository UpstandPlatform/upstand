import { describe, expect, test } from "bun:test";
import { GetResourceStatsUseCase } from "./get-resource-stats.usecase";

describe("GetResourceStatsUseCase", () => {
  test("bounds concurrent Docker stats requests", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const dockerService = {
      async getContainers() {
        return Array.from({ length: 40 }, (_, index) => ({
          id: `container-${index}`,
          name: `container-${index}`,
          status: "running",
          ports: "",
          node: "node-1",
        }));
      },
      async getContainerStats() {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeRequests -= 1;
        return {
          cpu: 1,
          ram: 0,
          ramUsage: 1,
          ramLimit: 2,
          networkRxBytes: 3,
          networkTxBytes: 4,
        };
      },
    };
    const uow = {
      resourceRepository: {
        async findById() {
          return { id: "resource-1", serverId: null };
        },
      },
      transaction: async (callback: (unitOfWork: never) => unknown) =>
        callback(uow as never),
    };

    const result = await new GetResourceStatsUseCase(
      uow as never,
      dockerService as never,
    ).execute({ id: "resource-1" });

    expect(maxActiveRequests).toBe(16);
    expect(result.containerCount).toBe(40);
    expect(result.cpu).toBe(40);
    expect(result.networkRxBytes).toBe(120);
    expect(result.networkTxBytes).toBe(160);
  });
});
