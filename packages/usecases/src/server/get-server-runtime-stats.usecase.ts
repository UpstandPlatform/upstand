import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { z } from "zod";
import type { ServerRuntimeStats } from "../ports/docker";
import type { DockerServerStatsService as DockerService } from "../resource/docker-client";
import { resolveDockerServiceForServer } from "../resource/docker-client";

export const GetServerRuntimeStatsInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
  serverId: z.string().min(1).optional(),
});

export type GetServerRuntimeStatsInput = z.infer<
  typeof GetServerRuntimeStatsInputSchema
>;

export class GetServerRuntimeStatsUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly dockerService: DockerService,
  ) {}

  async execute(
    input: GetServerRuntimeStatsInput,
  ): Promise<ServerRuntimeStats> {
    if (input.serverId && input.serverId !== "local") {
      const server = await this.uow.serverRepository.findById(input.serverId);
      if (!server || server.organizationId !== input.organizationId) {
        throw new ValidationError("Server not found");
      }
    }
    const { dockerService, cleanup } = await resolveDockerServiceForServer(
      input.serverId,
      this.uow,
      this.dockerService,
    );
    try {
      return await dockerService.getServerRuntimeStats();
    } finally {
      cleanup();
    }
  }
}
