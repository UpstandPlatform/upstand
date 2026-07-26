import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { z } from "zod";
import type { DockerResourceReadService as DockerService } from "./docker-client";
import { resolveDockerServiceForServer } from "./docker-client";
import { dockerLogLevels } from "./docker-log-filter";

export const GetResourceLogsInputSchema = z.object({
  id: z.string().min(1, "Resource ID is required"),
  containerId: z.string().optional(),
  tail: z.number().int().min(1).max(5_000).optional(),
  since: z.number().int().nonnegative().optional(),
  search: z.string().trim().max(200).optional(),
  levels: z.array(z.enum(dockerLogLevels)).max(5).optional(),
});

export type GetResourceLogsInput = z.infer<typeof GetResourceLogsInputSchema>;

export class GetResourceLogsUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly dockerService: DockerService,
  ) {}

  async execute(input: GetResourceLogsInput): Promise<string> {
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
        return await dockerService.getLogs(
          resource,
          input.containerId,
          input.tail ?? 150,
          input.since,
          { search: input.search, levels: input.levels },
        );
      } finally {
        cleanup();
      }
    });
  }
}
