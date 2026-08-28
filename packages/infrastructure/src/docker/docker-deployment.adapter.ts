import type {
  DockerAutoscalingPort,
  DockerCommandPort,
  DockerContainerControlPort,
  DockerDatabaseDeploymentPort,
  DockerDeploymentPort,
  DockerHostMaintenancePort,
  DockerPreviewCleanupPort,
  DockerResourceControlPort,
  DockerResourceReadPort,
  DockerSelfUpdatePort,
  DockerServerStatsPort,
  DockerServicePort,
  DockerSwarmManagementPort,
  DockerWebServerMaintenancePort,
  DockerWorkloadMigrationPort,
} from "@upstand/usecases";
import type { DockerResourceCommandBrokerPort } from "./docker-broker-client";
import {
  createDockerCleanupBrokerClient,
  createDockerResourceCommandBrokerClient,
  createDockerSelfUpdateBrokerClient,
  createDockerSwarmBrokerClient,
  createDockerWebServerBrokerClient,
} from "./docker-broker-client";

function bindCapability<T extends object>(
  service: DockerServicePort,
  methods: readonly (keyof DockerServicePort)[],
): T {
  return Object.fromEntries(
    methods.map((method) => {
      const implementation = service[method];
      if (typeof implementation !== "function") {
        throw new Error(`Docker capability method is unavailable: ${method}`);
      }
      return [method, implementation.bind(service)];
    }),
  ) as T;
}

export function createDockerResourceControlPort(
  service: DockerServicePort,
): DockerResourceControlPort {
  return bindCapability<DockerResourceControlPort>(service, [
    "controlService",
    "rollbackService",
    "removeResource",
    "removeDatabase",
  ]);
}

export function createDockerResourceReadPort(
  service: DockerServicePort,
): DockerResourceReadPort {
  return bindCapability<DockerResourceReadPort>(service, [
    "getContainers",
    "getRoutingServices",
    "getLogs",
    "getContainerStats",
  ]);
}

export function createDockerContainerControlPort(
  service: DockerServicePort,
): DockerContainerControlPort {
  return bindCapability<DockerContainerControlPort>(service, [
    "controlContainer",
  ]);
}

export function createDockerDatabaseDeploymentPort(
  service: DockerServicePort,
): DockerDatabaseDeploymentPort {
  return bindCapability<DockerDatabaseDeploymentPort>(service, [
    "removeDatabase",
    "deployDatabase",
  ]);
}

export function createDockerCommandPort(
  service: DockerServicePort,
): DockerCommandPort {
  return bindCapability<DockerCommandPort>(service, [
    "runCommandInResourceContainer",
  ]);
}

export function createDockerServerStatsPort(
  service: DockerServicePort,
): DockerServerStatsPort {
  return bindCapability<DockerServerStatsPort>(service, [
    "getServerRuntimeStats",
  ]);
}

export function createDockerSelfUpdatePort(
  service: DockerServicePort,
): DockerSelfUpdatePort {
  const capability = bindCapability<DockerSelfUpdatePort>(service, [
    "listServices",
    "inspectService",
    "updateService",
  ]);
  const typedBrokerClient = createDockerSelfUpdateBrokerClient();
  if (typedBrokerClient) {
    capability.applySelfUpdate = typedBrokerClient.applySelfUpdate;
  }
  return capability;
}

export function createDockerPreviewCleanupPort(
  service: DockerServicePort,
): DockerPreviewCleanupPort {
  return bindCapability<DockerPreviewCleanupPort>(service, [
    "removeServiceByName",
  ]);
}

export function createDockerWebServerMaintenancePort(
  service: DockerServicePort,
): DockerWebServerMaintenancePort {
  const typedBrokerClient = createDockerWebServerBrokerClient();
  if (typedBrokerClient) return typedBrokerClient;
  return bindCapability<DockerWebServerMaintenancePort>(service, [
    "forceServiceUpdate",
    "getServiceLogs",
    "execServiceCommand",
    "inspectNetwork",
  ] as const);
}

export function createDockerSwarmManagementPort(
  service: DockerServicePort,
): DockerSwarmManagementPort {
  const typedBrokerClient = createDockerSwarmBrokerClient();
  if (typedBrokerClient) return typedBrokerClient;
  return bindCapability<DockerSwarmManagementPort>(service, [
    "getInfo",
    "inspectSwarm",
    "listNodes",
    "listServices",
    "listTasks",
    "initialize",
    "updateSwarm",
    "inspectNode",
    "updateNode",
    "removeNode",
    "ensureUpstandNetwork",
  ] as const);
}

export function createDockerHostMaintenancePort(
  service: DockerServicePort,
): DockerHostMaintenancePort {
  const typedCleanup = createDockerCleanupBrokerClient();
  return {
    cleanupDocker:
      typedCleanup?.cleanupDocker ?? service.cleanupDocker.bind(service),
    checkGpuStatus: service.checkGpuStatus.bind(service),
    setupGpuSupport: service.setupGpuSupport.bind(service),
  };
}

export function createDockerWorkloadMigrationPort(
  service: DockerServicePort,
): DockerWorkloadMigrationPort {
  return bindCapability<DockerWorkloadMigrationPort>(service, [
    "sanitizeName",
    "deployAppImage",
    "waitForServiceConvergence",
    "runPostDeploySmokeTest",
    "removeResource",
    "getServerRuntimeStats",
    "serviceExists",
  ]);
}

export function createDockerAutoscalingPort(
  service: DockerServicePort,
): DockerAutoscalingPort {
  return bindCapability<DockerAutoscalingPort>(service, [
    "getContainers",
    "scaleService",
  ]);
}

/**
 * Runtime capability boundary for deployment workers.
 *
 * DockerService has additional inventory, pruning, and host-control methods
 * for API-facing workflows. Keep those methods out of the worker object even
 * though both capabilities use the same broker-backed implementation today.
 */
export function createDockerDeploymentPort(
  service: DockerServicePort,
  typedResourceCommandOverride?: DockerResourceCommandBrokerPort,
): DockerDeploymentPort {
  const deployment: DockerDeploymentPort = {
    sanitizeName: service.sanitizeName.bind(service),
    setCancellationKey: service.setCancellationKey.bind(service),
    deployDatabase: service.deployDatabase.bind(service),
    deployAppImage: service.deployAppImage.bind(service),
    deployAppGit: service.deployAppGit.bind(service),
    readComposeFileFromGit: service.readComposeFileFromGit.bind(service),
    deployComposeStack: service.deployComposeStack.bind(service),
    waitForServiceConvergence: service.waitForServiceConvergence.bind(service),
    runPostDeploySmokeTest: service.runPostDeploySmokeTest.bind(service),
    rollbackService: service.rollbackService.bind(service),
    promoteServiceRevision: service.promoteServiceRevision.bind(service),
    removeServiceRevision: service.removeServiceRevision.bind(service),
    transferImage: service.transferImage.bind(service),
    configureDatabaseReplication:
      service.configureDatabaseReplication.bind(service),
    runCommandInResourceContainer:
      service.runCommandInResourceContainer.bind(service),
  };

  if (service.serviceExists) {
    deployment.serviceExists = service.serviceExists.bind(service);
  }
  const typedResourceCommand =
    typedResourceCommandOverride ?? createDockerResourceCommandBrokerClient();
  if (typedResourceCommand) {
    deployment.execContainerCommand = async (
      target,
      serviceName,
      command,
      options,
      resourceId,
    ) => {
      if (target.kind === "local") {
        if (!resourceId) {
          throw new Error(
            "A resource ID is required for local deployment command execution",
          );
        }
        return typedResourceCommand.execResourceServiceCommand(
          target,
          serviceName,
          command,
          options,
          resourceId,
        );
      }
      if (service.execContainerCommand) {
        return service.execContainerCommand(
          target,
          serviceName,
          command,
          options,
          resourceId,
        );
      }
      throw new Error(
        "Docker deployment command execution is unavailable for the remote target",
      );
    };
  } else if (service.execContainerCommand) {
    deployment.execContainerCommand =
      service.execContainerCommand.bind(service);
  }

  return deployment;
}
