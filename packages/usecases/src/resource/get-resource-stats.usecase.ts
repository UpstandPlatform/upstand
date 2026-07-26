import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { z } from "zod";
import type { ContainerRuntimeStats } from "../ports/docker";
import type { DockerResourceReadService as DockerService } from "./docker-client";
import { resolveDockerServiceForServer } from "./docker-client";

export const GetResourceStatsInputSchema = z.object({
  id: z.string().min(1, "Resource ID is required"),
});

export type GetResourceStatsInput = z.infer<typeof GetResourceStatsInputSchema>;

export interface ResourceRuntimeStats extends ContainerRuntimeStats {
  containerCount: number;
  collectedAt: string;
}

export class GetResourceStatsUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly dockerService: DockerService,
  ) {}

  async execute(input: GetResourceStatsInput): Promise<ResourceRuntimeStats> {
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
        if (containers.length === 0) {
          return {
            cpu: 0,
            ram: 0,
            ramUsage: 0,
            ramLimit: 0,
            networkRxBytes: 0,
            networkTxBytes: 0,
            containerCount: 0,
            collectedAt: new Date().toISOString(),
          };
        }

        const containerStats = await Promise.all(
          containers.map((container) =>
            dockerService.getContainerStats(container.id),
          ),
        );
        const total = containerStats.reduce<ContainerRuntimeStats>(
          (aggregate, current) => ({
            cpu: aggregate.cpu + current.cpu,
            ram: 0,
            ramUsage: aggregate.ramUsage + current.ramUsage,
            ramLimit: aggregate.ramLimit + current.ramLimit,
            networkRxBytes: aggregate.networkRxBytes + current.networkRxBytes,
            networkTxBytes: aggregate.networkTxBytes + current.networkTxBytes,
          }),
          {
            cpu: 0,
            ram: 0,
            ramUsage: 0,
            ramLimit: 0,
            networkRxBytes: 0,
            networkTxBytes: 0,
          },
        );

        return {
          ...total,
          cpu: Number.parseFloat(total.cpu.toFixed(2)),
          ram:
            total.ramLimit > 0
              ? Number.parseFloat(
                  ((total.ramUsage / total.ramLimit) * 100).toFixed(2),
                )
              : 0,
          containerCount: containers.length,
          collectedAt: new Date().toISOString(),
        };
      } finally {
        cleanup();
      }
    });
  }
}
