import { describe, expect, test } from "bun:test";
import type { Resource } from "@upstand/domain";
import { configureMonitoringAgent } from "../server/monitoring-agent.client";
import { AutoscalingService } from "./autoscaling.service";

function resource(advancedConfig: object, type = "application"): Resource {
  return {
    id: "resource-1",
    environmentId: "environment-1",
    name: "Web",
    type,
    status: "running",
    provider: "github",
    appName: "web",
    buildConfig: "{}",
    advancedConfig: JSON.stringify(advancedConfig),
    envVars: "{}",
    domains: "[]",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createService(metrics: unknown, containers = 2) {
  const scaledTo: number[] = [];
  configureMonitoringAgent({
    request: async <T>() => metrics as T,
  });
  const docker = {
    getContainers: async () => Array.from({ length: containers }, () => ({})),
    scaleService: async (_resource: Resource, replicas: number) => {
      scaledTo.push(replicas);
    },
  };
  const uow = {};
  return {
    service: new AutoscalingService(uow as never, docker as never),
    scaledTo,
  };
}

describe("AutoscalingService", () => {
  test("scales up when a target metric is exceeded and caps at max replicas", async () => {
    const { service, scaledTo } = createService([{ CPU: 95 }], 2);
    const decision = await service.reconcileResource(
      resource({
        autoscaling: {
          enabled: true,
          minReplicas: 1,
          maxReplicas: 3,
          targetCpuPercent: 80,
          scaleUpStep: 2,
          scaleDownStep: 1,
          cooldownSeconds: 10,
        },
      }),
    );

    expect(decision).toMatchObject({
      currentReplicas: 2,
      desiredReplicas: 3,
    });
    expect(scaledTo).toEqual([3]);
  });

  test("scales down toward the configured minimum when all configured targets are low", async () => {
    const { service, scaledTo } = createService([{ CPU: 20 }], 4);
    const decision = await service.reconcileResource(
      resource({
        autoscaling: {
          enabled: true,
          minReplicas: 2,
          maxReplicas: 6,
          targetCpuPercent: 80,
          scaleUpStep: 1,
          scaleDownStep: 3,
          cooldownSeconds: 10,
        },
      }),
    );

    expect(decision?.desiredReplicas).toBe(2);
    expect(scaledTo).toEqual([2]);
  });

  test("skips compose and database resources and honors the cooldown after a scale", async () => {
    const first = createService([{ CPU: 95 }], 1);
    const app = resource({
      autoscaling: {
        enabled: true,
        minReplicas: 1,
        maxReplicas: 3,
        targetCpuPercent: 80,
        scaleUpStep: 1,
        scaleDownStep: 1,
        cooldownSeconds: 10,
      },
    });
    await first.service.reconcileResource(app);
    expect(first.scaledTo).toEqual([2]);
    await expect(first.service.reconcileResource(app)).resolves.toBeNull();

    const database = createService([{ CPU: 95 }], 1);
    await expect(
      database.service.reconcileResource(
        resource(
          {
            autoscaling: {
              enabled: true,
              minReplicas: 1,
              maxReplicas: 3,
              targetCpuPercent: 80,
              scaleUpStep: 1,
              scaleDownStep: 1,
              cooldownSeconds: 10,
            },
          },
          "database",
        ),
      ),
    ).resolves.toBeNull();
    expect(database.scaledTo).toEqual([]);
  });
});
