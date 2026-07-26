import {
  type IUnitOfWork,
  type Resource,
  ValidationError,
} from "@upstand/domain";
import { z } from "zod";
import type { DockerContainerControlService as DockerService } from "./docker-client";
import { resolveDockerServiceForServer } from "./docker-client";

export const ControlContainerInputSchema = z.object({
  resourceId: z.string().min(1, "Resource ID is required"),
  containerId: z
    .string()
    .min(1, "Container ID is required")
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/, "Invalid container ID"),
  command: z.enum(["start", "stop", "restart", "kill"]),
});

export type ControlContainerInput = z.infer<typeof ControlContainerInputSchema>;

export class ControlContainerUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly dockerService: DockerService,
  ) {}

  async execute(input: ControlContainerInput): Promise<Resource> {
    return this.uow.transaction(async (tx) => {
      const resource = await tx.resourceRepository.findById(input.resourceId);
      if (!resource) throw new ValidationError("Resource not found");

      const { dockerService, cleanup } = await resolveDockerServiceForServer(
        resource.serverId,
        tx,
        this.dockerService,
      );

      try {
        await dockerService.controlContainer(
          resource,
          input.containerId,
          input.command,
        );

        return resource;
      } finally {
        cleanup();
      }
    });
  }
}
