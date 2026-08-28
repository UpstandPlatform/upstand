import { describe, expect, test } from "bun:test";
import type { DockerServicePort } from "@upstand/usecases";
import {
  createDockerAutoscalingPort,
  createDockerCommandPort,
  createDockerContainerControlPort,
  createDockerDatabaseDeploymentPort,
  createDockerDeploymentPort,
  createDockerHostMaintenancePort,
  createDockerPreviewCleanupPort,
  createDockerResourceControlPort,
  createDockerResourceReadPort,
  createDockerSelfUpdatePort,
  createDockerServerStatsPort,
  createDockerSwarmManagementPort,
  createDockerWorkloadMigrationPort,
} from "./docker-deployment.adapter";

describe("createDockerDeploymentPort", () => {
  test("routes local hook commands through the typed resource boundary", async () => {
    const fallbackCalls: string[] = [];
    const typedCalls: unknown[] = [];
    const service = Object.fromEntries(
      [
        "sanitizeName",
        "setCancellationKey",
        "deployDatabase",
        "deployAppImage",
        "deployAppGit",
        "readComposeFileFromGit",
        "deployComposeStack",
        "waitForServiceConvergence",
        "runPostDeploySmokeTest",
        "rollbackService",
        "promoteServiceRevision",
        "removeServiceRevision",
        "transferImage",
        "configureDatabaseReplication",
        "runCommandInResourceContainer",
      ].map((name) => [name, () => undefined]),
    ) as Record<string, (...args: unknown[]) => unknown>;
    service.execContainerCommand = async (...args: unknown[]) => {
      fallbackCalls.push(JSON.stringify(args));
      return { output: "fallback", exitCode: 0 };
    };
    const typedResourceCommand = {
      execResourceServiceCommand: async (...args: unknown[]) => {
        typedCalls.push(args);
        return { output: "typed", exitCode: 0 };
      },
    } as unknown as import("./docker-broker-client").DockerResourceCommandBrokerPort;

    const deployment = createDockerDeploymentPort(
      service as unknown as DockerServicePort,
      typedResourceCommand,
    );

    await expect(
      deployment.execContainerCommand?.(
        { kind: "local", name: "Target" },
        "resource-service",
        "printf ok",
        { timeoutSeconds: 30 },
        "resource-1",
      ),
    ).resolves.toEqual({ output: "typed", exitCode: 0 });
    expect(typedCalls).toHaveLength(1);
    expect(fallbackCalls).toHaveLength(0);

    await expect(
      deployment.execContainerCommand?.(
        { kind: "local", name: "Target" },
        "resource-service",
        "printf ok",
      ),
    ).rejects.toThrow("resource ID is required");

    await expect(
      deployment.execContainerCommand?.(
        {
          kind: "remote",
          name: "remote",
          host: "remote",
          port: 22,
          username: "upstand",
        },
        "resource-service",
        "printf ok",
        undefined,
        "resource-1",
      ),
    ).resolves.toEqual({ output: "fallback", exitCode: 0 });
    expect(fallbackCalls).toHaveLength(1);
  });

  test("exposes only deployment capabilities", () => {
    const methodNames = [
      "sanitizeName",
      "setCancellationKey",
      "deployDatabase",
      "deployAppImage",
      "deployAppGit",
      "readComposeFileFromGit",
      "deployComposeStack",
      "waitForServiceConvergence",
      "runPostDeploySmokeTest",
      "rollbackService",
      "promoteServiceRevision",
      "removeServiceRevision",
      "transferImage",
      "configureDatabaseReplication",
      "runCommandInResourceContainer",
    ] as const;
    const service = Object.fromEntries(
      methodNames.map((name) => [name, () => undefined]),
    ) as unknown as DockerServicePort;

    const deployment = createDockerDeploymentPort(service);

    expect(Object.keys(deployment).sort()).toEqual([...methodNames].sort());
    expect(deployment).not.toHaveProperty("getContainers");
    expect(deployment).not.toHaveProperty("prune");
    expect(deployment).not.toHaveProperty("swarmInit");
    expect(deployment).not.toHaveProperty("listImages");
  });

  test("exposes resource workflows as isolated capabilities", () => {
    const methodNames = [
      "controlService",
      "rollbackService",
      "removeResource",
      "removeDatabase",
      "getContainers",
      "getRoutingServices",
      "getLogs",
      "getContainerStats",
      "controlContainer",
      "deployDatabase",
      "runCommandInResourceContainer",
      "getServerRuntimeStats",
    ] as const;
    const service = Object.fromEntries(
      methodNames.map((name) => [name, () => undefined]),
    ) as unknown as DockerServicePort;

    const capabilities = [
      [
        createDockerResourceControlPort(service),
        [
          "controlService",
          "rollbackService",
          "removeResource",
          "removeDatabase",
        ],
      ],
      [
        createDockerResourceReadPort(service),
        ["getContainers", "getRoutingServices", "getLogs", "getContainerStats"],
      ],
      [createDockerContainerControlPort(service), ["controlContainer"]],
      [
        createDockerDatabaseDeploymentPort(service),
        ["removeDatabase", "deployDatabase"],
      ],
      [createDockerCommandPort(service), ["runCommandInResourceContainer"]],
      [createDockerServerStatsPort(service), ["getServerRuntimeStats"]],
    ] as const;

    for (const [capability, expected] of capabilities) {
      expect(Object.keys(capability).sort()).toEqual([...expected].sort());
      expect(capability).not.toHaveProperty("listContainers");
      expect(capability).not.toHaveProperty("swarmInit");
      expect(capability).not.toHaveProperty("prune");
    }
  });

  test("exposes migration and autoscaling as separate narrow capabilities", () => {
    const methodNames = [
      "sanitizeName",
      "deployAppImage",
      "waitForServiceConvergence",
      "runPostDeploySmokeTest",
      "removeResource",
      "getServerRuntimeStats",
      "serviceExists",
      "getContainers",
      "scaleService",
    ] as const;
    const service = Object.fromEntries(
      methodNames.map((name) => [name, () => undefined]),
    ) as unknown as DockerServicePort;

    const migration = createDockerWorkloadMigrationPort(service);
    const autoscaling = createDockerAutoscalingPort(service);

    expect(Object.keys(migration).sort()).toEqual(
      [
        "deployAppImage",
        "getServerRuntimeStats",
        "removeResource",
        "runPostDeploySmokeTest",
        "sanitizeName",
        "serviceExists",
        "waitForServiceConvergence",
      ].sort(),
    );
    expect(Object.keys(autoscaling).sort()).toEqual(
      ["getContainers", "scaleService"].sort(),
    );
    expect(migration).not.toHaveProperty("scaleService");
    expect(autoscaling).not.toHaveProperty("removeResource");
  });

  test("exposes only control-plane service update operations", () => {
    const service = {
      listServices: async () => [],
      inspectService: async () => ({
        version: 1,
        name: "upstand-server",
        taskTemplate: {},
      }),
      updateService: async () => undefined,
    } as unknown as DockerServicePort;

    const capability = createDockerSelfUpdatePort(service);

    expect(Object.keys(capability).sort()).toEqual(
      ["inspectService", "listServices", "updateService"].sort(),
    );
    expect(capability).not.toHaveProperty("removeResource");
    expect(capability).not.toHaveProperty("swarmInit");
  });

  test("exposes preview cleanup without service inspection", () => {
    const service = {
      removeServiceByName: async () => undefined,
    } as unknown as DockerServicePort;
    const capability = createDockerPreviewCleanupPort(service);

    expect(Object.keys(capability)).toEqual(["removeServiceByName"]);
    expect(capability).not.toHaveProperty("listServices");
    expect(capability).not.toHaveProperty("getService");
  });

  test("exposes host maintenance and Swarm operations as separate capabilities", () => {
    const service = {
      cleanupDocker: async () => undefined,
      checkGpuStatus: async () => ({
        driverInstalled: false,
        runtimeInstalled: false,
        runtimeConfigured: false,
        cudaSupport: false,
        availableGPUs: 0,
        swarmEnabled: false,
        gpuResources: 0,
      }),
      setupGpuSupport: async () => undefined,
      getInfo: async () => ({
        localNodeState: "inactive",
        controlAvailable: false,
        nodeId: "",
        nodeAddress: "",
        nodeCount: 0,
      }),
      inspectSwarm: async () => ({
        id: "",
        version: 0,
        createdAt: null,
        updatedAt: null,
        dataPathPort: null,
        defaultAddressPools: [],
      }),
      listNodes: async () => [],
      listServices: async () => [],
      listTasks: async () => [],
      initialize: async () => undefined,
      updateSwarm: async () => undefined,
      inspectNode: async () => {
        throw new Error("not implemented");
      },
      updateNode: async () => undefined,
      removeNode: async () => undefined,
      ensureUpstandNetwork: async () => ({ id: "", created: false }),
    } as unknown as DockerServicePort;

    expect(
      Object.keys(createDockerHostMaintenancePort(service)).sort(),
    ).toEqual(["checkGpuStatus", "cleanupDocker", "setupGpuSupport"].sort());
    expect(
      Object.keys(createDockerSwarmManagementPort(service)).sort(),
    ).toEqual(
      [
        "ensureUpstandNetwork",
        "getInfo",
        "initialize",
        "inspectNode",
        "inspectSwarm",
        "listNodes",
        "listServices",
        "listTasks",
        "removeNode",
        "updateNode",
        "updateSwarm",
      ].sort(),
    );
  });
});
