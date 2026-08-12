import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";
import {
  getConfiguredControlPlaneMode,
  getPlatformCapabilities,
} from "../platform/platform.types";
import type {
  DockerArchiveTransferPort,
  DockerContainerCommand,
  DockerContainerControllerPort,
  DockerInventoryReaderPort,
  DockerResourceControllerPort,
} from "../ports/docker";
import { dockerLogLevels } from "../resource/docker-log-filter";
import {
  containerBelongsToResource,
  matchesContainerIdentifier,
} from "./container-ownership";
import { resolveDockerInspectionTarget } from "./docker-inspection-target.helper";

function normalizeDockerServerId(serverId: string | null | undefined): string {
  return !serverId || serverId === "local" || serverId === "manager"
    ? "local"
    : serverId;
}

function assertResourceDockerTarget(
  resourceServerId: string | null | undefined,
  requestedServerId: string | null | undefined,
): void {
  if (
    normalizeDockerServerId(resourceServerId) !==
    normalizeDockerServerId(requestedServerId)
  ) {
    throw new Error("Docker target is not assigned to the requested resource.");
  }
}

export const DockerInventoryKindSchema = z.enum([
  "info",
  "containers",
  "images",
  "volumes",
  "networks",
  "services",
  "swarm_nodes",
  "logs",
  "stats",
]);
export const GetDockerInventoryInputSchema = z.object({
  organizationId: z.string().min(1),
  serverId: z.string().min(1).optional(),
  kind: DockerInventoryKindSchema,
  containerId: z.string().min(1).optional(),
  serviceName: z.string().min(1).optional(),
  search: z.string().trim().max(200).optional(),
  state: z
    .enum([
      "created",
      "running",
      "paused",
      "restarting",
      "removing",
      "exited",
      "dead",
    ])
    .optional(),
  since: z.number().int().nonnegative().optional(),
  searchLogs: z.string().trim().max(200).optional(),
  logLevels: z.array(z.enum(dockerLogLevels)).max(5).optional(),
  tail: z.number().int().positive().max(1000).default(150),
});

export const ControlDockerContainerInputSchema = z.object({
  organizationId: z.string().min(1),
  serverId: z.string().min(1).optional(),
  containerId: z.string().min(1),
  command: z.enum(["restart", "stop", "start", "remove"]),
});

export const ControlDockerResourceInputSchema = z.object({
  organizationId: z.string().min(1),
  serverId: z.string().min(1).optional(),
  resourceId: z.string().min(1),
  command: z.enum(["remove-volume", "remove-network", "remove-image"]),
});

export const UploadDockerVolumeInputSchema = z.object({
  organizationId: z.string().min(1),
  serverId: z.string().min(1).optional(),
  volumeName: z.string().min(1).max(128),
  destination: z.string().trim().max(512).default("/"),
});

export const UploadDockerContainerInputSchema = z.object({
  organizationId: z.string().min(1),
  resourceId: z.string().min(1),
  serverId: z.string().min(1).optional(),
  containerId: z.string().min(1),
  destination: z.string().trim().max(512).default("/"),
});

export type GetDockerInventoryInput = z.infer<
  typeof GetDockerInventoryInputSchema
>;

export type DockerInventoryExecutionOptions = {
  allowLocalInCloud?: boolean;
};

export class GetDockerInventoryUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly inventory: DockerInventoryReaderPort,
    private readonly containerController: DockerContainerControllerPort,
    private readonly resourceController: DockerResourceControllerPort,
    private readonly archiveTransfer: DockerArchiveTransferPort,
  ) {}

  async execute(
    input: GetDockerInventoryInput,
    options: DockerInventoryExecutionOptions = {},
  ) {
    const mode = getConfiguredControlPlaneMode();
    const capabilities = getPlatformCapabilities(mode);
    const target = await resolveDockerInspectionTarget(this.uow, input, {
      allowLocalInCloud: options.allowLocalInCloud,
    });
    switch (input.kind) {
      case "info":
        return this.inventory.getInfo(target);
      case "containers":
        return this.inventory.listContainers(target, {
          search: input.search,
          state: input.state,
        });
      case "images":
        return this.inventory.listImages(target);
      case "volumes":
        return this.inventory.listVolumes(target);
      case "networks":
        return this.inventory.listNetworks(target);
      case "services":
        // Swarm services are only available in self-hosted Swarm mode
        if (!capabilities.swarmManagement) return [];
        return this.inventory.listServices(target);
      case "swarm_nodes":
        // Swarm node list is only available in self-hosted Swarm mode
        if (!capabilities.swarmManagement) return [];
        return this.inventory.listSwarmNodes(target);
      case "logs":
        return this.inventory.getLogs(target, {
          containerId: input.containerId,
          serviceName: input.serviceName,
          tail: input.tail,
          since: input.since,
          search: input.searchLogs,
          levels: input.logLevels,
        });
      case "stats":
        if (!input.containerId) {
          throw new Error("A container ID is required for stats.");
        }
        return this.inventory.getContainerStats(target, input.containerId);
    }
  }

  async controlContainer(
    input: z.infer<typeof ControlDockerContainerInputSchema>,
  ) {
    const target = await resolveDockerInspectionTarget(this.uow, input);
    return this.containerController.controlContainer(
      target,
      input.containerId,
      input.command as DockerContainerCommand,
    );
  }

  async controlResource(
    input: z.infer<typeof ControlDockerResourceInputSchema>,
  ) {
    const target = await resolveDockerInspectionTarget(this.uow, input);
    return this.resourceController.controlResource(
      target,
      input.resourceId,
      input.command,
    );
  }

  async getHostTime(input: { organizationId: string; serverId?: string }) {
    const target = await resolveDockerInspectionTarget(this.uow, input);
    return this.inventory.getHostTime(target);
  }

  async uploadVolume(
    input: z.infer<typeof UploadDockerVolumeInputSchema>,
    archive: Buffer,
  ) {
    const target = await resolveDockerInspectionTarget(this.uow, input);
    return this.archiveTransfer.uploadArchiveToVolume(
      target,
      input.volumeName,
      archive,
      input.destination,
    );
  }

  async uploadContainer(
    input: z.infer<typeof UploadDockerContainerInputSchema>,
    archive: Buffer,
  ) {
    const resource = await this.uow.resourceRepository.findById(
      input.resourceId,
    );
    if (!resource) throw new Error("Resource was not found.");
    const environment = await this.uow.environmentRepository.findById(
      resource.environmentId,
    );
    const project = environment
      ? await this.uow.projectRepository.findById(environment.projectId)
      : null;
    if (!project || project.organizationId !== input.organizationId) {
      throw new Error("Resource is not part of the active organization.");
    }

    assertResourceDockerTarget(resource.serverId, input.serverId);
    const target = await resolveDockerInspectionTarget(this.uow, input, {
      localServerIds: ["local", "manager"],
    });
    const containers = await this.inventory.listContainers(target);
    const container = containers.find(
      (candidate) =>
        matchesContainerIdentifier(input.containerId, candidate.id) &&
        containerBelongsToResource(candidate, resource),
    );
    if (!container) {
      throw new Error("Container is not part of the requested resource.");
    }

    return this.archiveTransfer.uploadArchiveToContainer(
      target,
      container.id,
      archive,
      input.destination,
    );
  }
}
