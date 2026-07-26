import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { z } from "zod";
import type { DockerResourceReadService as DockerService } from "./docker-client";
import { resolveDockerServiceForServer } from "./docker-client";

export const GetResourceRoutingTargetsInputSchema = z.object({
  id: z.string().min(1, "Resource ID is required"),
});

export type GetResourceRoutingTargetsInput = z.infer<
  typeof GetResourceRoutingTargetsInputSchema
>;

export class GetResourceRoutingTargetsUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly dockerService: DockerService,
  ) {}

  async execute(input: GetResourceRoutingTargetsInput): Promise<string[]> {
    const resource = await this.uow.resourceRepository.findById(input.id);
    if (!resource) throw new ValidationError("Resource not found");

    const { dockerService, cleanup } = await resolveDockerServiceForServer(
      resource.serverId,
      this.uow,
      this.dockerService,
    );

    try {
      return await dockerService.getRoutingServices(resource);
    } finally {
      cleanup();
    }
  }
}
