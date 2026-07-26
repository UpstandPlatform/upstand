import {
  type IUnitOfWork,
  type Resource,
  ValidationError,
} from "@upstand/domain";
import { z } from "zod";
import { QueueDeploymentUseCase } from "../deployment/queue-deployment.usecase";
import type { DockerResourceControlService as DockerService } from "./docker-client";
import { resolveDockerServiceForServer } from "./docker-client";

export const ControlResourceInputSchema = z.object({
  id: z.string().min(1, "Resource ID is required"),
  command: z.enum(["start", "stop", "restart"]),
});

export type ControlResourceInput = z.infer<typeof ControlResourceInputSchema>;

export class ControlResourceUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly dockerService: DockerService,
  ) {}

  async execute(input: ControlResourceInput): Promise<Resource> {
    const resource = await this.uow.transaction(async (tx) => {
      const found = await tx.resourceRepository.findById(input.id);
      if (!found) {
        throw new ValidationError("Resource not found");
      }
      return found;
    });

    // Repository-backed Compose resources need their source checkout and
    // deployment worker to start again. Queueing also preserves the same
    // locking, server selection, and deployment history as a manual deploy.
    if (
      resource.type === "compose" &&
      resource.provider !== "raw" &&
      input.command !== "stop"
    ) {
      return new QueueDeploymentUseCase(this.uow).execute({
        resourceId: resource.id,
        title: `${input.command === "restart" ? "Restart" : "Start"} resource`,
      });
    }

    return this.uow.transaction(async (tx) => {
      const { dockerService, cleanup } = await resolveDockerServiceForServer(
        resource.serverId,
        tx,
        this.dockerService,
      );

      try {
        await dockerService.controlService(resource, input.command);

        const status = input.command === "stop" ? "stopped" : "running";

        const updated = await tx.resourceRepository.updateById(resource.id, {
          status,
        });

        if (!updated) {
          throw new ValidationError("Resource could not be updated");
        }
        return updated;
      } finally {
        cleanup();
      }
    });
  }
}
