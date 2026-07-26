import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { z } from "zod";
import type { DockerResourceContainer } from "../ports/docker";
import type { DockerResourceReadService as DockerService } from "./docker-client";
import { resolveDockerServiceForServer } from "./docker-client";

export const GetResourceContainersInputSchema = z.object({
  id: z.string().min(1, "Resource ID is required"),
});

export type GetResourceContainersInput = z.infer<
  typeof GetResourceContainersInputSchema
>;

export class GetResourceContainersUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly dockerService: DockerService,
  ) {}

  async execute(
    input: GetResourceContainersInput,
  ): Promise<DockerResourceContainer[]> {
    return this.uow.transaction(async (tx) => {
      const resource = await tx.resourceRepository.findById(input.id);
      if (!resource) {
        throw new ValidationError("Resource not found");
      }

      const { dockerService, cleanup } = await resolveDockerServiceForServer(
        resource.serverId,
        tx,
        this.dockerService,
      );

      try {
        const containers = await dockerService.getContainers(resource);

        try {
          await tx.resourceRuntimeRepository.upsert(input.id, {
            version: 1,
            containers,
            observedAt: new Date(),
            source: "docker-live",
          });
        } catch {
          // Runtime state is an observability cache. A cache write must never
          // turn a successful live Docker read into a failed request.
        }

        return containers;
      } finally {
        cleanup();
      }
    });
  }
}
