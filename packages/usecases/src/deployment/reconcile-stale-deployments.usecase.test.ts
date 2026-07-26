import { describe, expect, test } from "bun:test";
import type { Deployment, IUnitOfWork, Resource } from "@upstand/domain";
import { ReconcileStaleDeploymentsUseCase } from "./reconcile-stale-deployments.usecase";

describe("ReconcileStaleDeploymentsUseCase", () => {
  test("marks deployments whose heartbeat expired and stops the resource", async () => {
    const now = new Date("2026-07-26T12:00:00.000Z");
    const deployment = {
      id: "dep-stale",
      resourceId: "resource-1",
      status: "running",
      heartbeatAt: new Date("2026-07-26T11:00:00.000Z"),
      updatedAt: new Date("2026-07-26T11:00:00.000Z"),
    } as Deployment;
    const resource = {
      id: "resource-1",
      status: "running",
      advancedConfig: JSON.stringify({
        deploymentReliability: { staleAfterSeconds: 60 },
      }),
    } as Resource;
    const marked: Array<[string, Date, string]> = [];
    const resourceUpdates: Array<[string, Record<string, unknown>]> = [];
    const uow = {
      deploymentRepository: {
        findStaleRunning: async () => [deployment],
        markStale: async (id: string, before: Date, reason: string) => {
          marked.push([id, before, reason]);
          return deployment;
        },
      },
      resourceRepository: {
        findById: async () => resource,
        updateById: async (id: string, patch: Record<string, unknown>) => {
          resourceUpdates.push([id, patch]);
          return resource;
        },
      },
    } as unknown as IUnitOfWork;

    const result = await new ReconcileStaleDeploymentsUseCase(uow).execute({
      now,
    });

    expect(result).toEqual({
      inspected: 1,
      markedStale: 1,
      deploymentIds: ["dep-stale"],
    });
    expect(marked[0]?.[0]).toBe("dep-stale");
    expect(resourceUpdates).toEqual([["resource-1", { status: "stopped" }]]);
  });
});
