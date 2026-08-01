import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";
import type {
  DockerExecPort,
  DockerInventoryReaderPort,
} from "../ports/docker";

export const ExecContainerCommandInputSchema = z.object({
  organizationId: z.string().min(1),
  serverId: z.string().min(1).optional(),
  containerId: z.string().min(1).optional(),
  resourceId: z.string().min(1),
  command: z.string().min(1),
});

import {
  containerBelongsToResource,
  matchesContainerIdentifier,
} from "./container-resolution.helper";
import { resolveDockerInspectionTarget } from "./docker-inspection-target.helper";

export class ExecContainerCommandUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly docker: DockerExecPort,
    private readonly dockerInventory: DockerInventoryReaderPort,
  ) {}

  async execute(input: z.infer<typeof ExecContainerCommandInputSchema>) {
    const resource = await this.uow.resourceRepository.findById(
      input.resourceId,
    );
    if (!resource) throw new Error("Resource not found.");

    const environment = await this.uow.environmentRepository.findById(
      resource.environmentId,
    );
    const project = environment
      ? await this.uow.projectRepository.findById(environment.projectId)
      : null;
    if (!project || project.organizationId !== input.organizationId) {
      throw new Error("Resource is not part of the active organization.");
    }

    const resourceServerId = resource.serverId || "local";
    if (
      input.serverId &&
      (input.serverId === "manager" ? "local" : input.serverId) !==
        (resourceServerId === "manager" ? "local" : resourceServerId)
    ) {
      throw new Error("Resource is not assigned to the requested server.");
    }

    const target = await resolveDockerInspectionTarget(
      this.uow,
      {
        organizationId: input.organizationId,
        serverId: resourceServerId,
      },
      { localServerIds: ["local", "manager"] },
    );
    const containers = await this.dockerInventory.listContainers(target);
    const ownedContainers = containers.filter((container) =>
      containerBelongsToResource(container, resource),
    );
    const selected = input.containerId
      ? ownedContainers.find(
          (container) =>
            matchesContainerIdentifier(
              input.containerId as string,
              container.id,
            ) ||
            matchesContainerIdentifier(
              input.containerId as string,
              container.name,
            ),
        )
      : ownedContainers[0];

    if (!selected) {
      throw new Error("Container is not part of the requested resource.");
    }

    return this.docker.execContainerCommand(target, selected.id, input.command);
  }
}
