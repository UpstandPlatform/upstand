import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import {
  GetServerHistoricalMetricsInputSchema,
  GetServerHistoricalMetricsUseCase,
} from "./get-server-historical-metrics.usecase";
import { GetServerMonitoringStatusUseCase } from "./get-server-monitoring-status.usecase";
import { configureMonitoringAgent } from "./monitoring-agent.client";

function createMockUow() {
  const servers = new Map([
    [
      "6397a1fc-4976-423d-9abd-48d7c68b1dc4",
      {
        id: "6397a1fc-4976-423d-9abd-48d7c68b1dc4",
        organizationId: "org-1",
        name: "Remote Host",
        status: "ready",
      },
    ],
  ]);
  const monitoringSettings = new Map([
    [
      "6397a1fc-4976-423d-9abd-48d7c68b1dc4",
      {
        serverId: "6397a1fc-4976-423d-9abd-48d7c68b1dc4",
        token: "secret-token",
        cpuThreshold: 90,
        memoryThreshold: 90,
      },
    ],
  ]);

  return {
    serverRepository: {
      findById: async (id: string) => servers.get(id) ?? null,
    },
    monitoringSettingsRepository: {
      findByServerId: async (id: string) => monitoringSettings.get(id) ?? null,
    },
  } as unknown as IUnitOfWork;
}

describe("Monitoring Usecases", () => {
  test("GetServerMonitoringStatusUseCase captures ECONNREFUSED unreachability gracefully", async () => {
    configureMonitoringAgent({
      request: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    const uow = createMockUow();
    const usecase = new GetServerMonitoringStatusUseCase(uow);
    const result = await usecase.execute({
      organizationId: "org-1",
      serverId: "6397a1fc-4976-423d-9abd-48d7c68b1dc4",
    });

    expect(result.reachable).toBeFalse();
    expect(result.status).toBe("unhealthy");
    expect(result.collectionError).toContain(
      "Failed to contact monitoring agent for 6397a1fc-4976-423d-9abd-48d7c68b1dc4: ECONNREFUSED",
    );
  });

  test("GetServerHistoricalMetricsUseCase returns empty array when monitoring agent is unreachable", async () => {
    configureMonitoringAgent({
      request: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    const uow = createMockUow();
    const usecase = new GetServerHistoricalMetricsUseCase(uow);
    const metrics = await usecase.execute(
      GetServerHistoricalMetricsInputSchema.parse({
        organizationId: "org-1",
        serverId: "6397a1fc-4976-423d-9abd-48d7c68b1dc4",
      }),
    );

    expect(metrics).toEqual([]);
  });

  test("GetServerHistoricalMetricsUseCase returns metrics when agent is reachable", async () => {
    const mockData = [
      { timestamp: "2026-07-21T22:00:00Z", cpu: 15, memUsed: 42 },
    ];
    configureMonitoringAgent({
      request: async () => mockData as never,
    });

    const uow = createMockUow();
    const usecase = new GetServerHistoricalMetricsUseCase(uow);
    const metrics = await usecase.execute(
      GetServerHistoricalMetricsInputSchema.parse({
        organizationId: "org-1",
        serverId: "6397a1fc-4976-423d-9abd-48d7c68b1dc4",
      }),
    );

    expect(metrics).toEqual(mockData);
  });
});
