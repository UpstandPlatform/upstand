import { randomUUID } from "node:crypto";
import type { IUnitOfWork, Resource } from "@upstand/domain";
import { z } from "zod";
import { getDatabaseEnvironment } from "./database-environment";
import type { DockerDatabaseDeploymentService as DockerService } from "./docker-client";
import { resolveDockerServiceForServer } from "./docker-client";

export const RebuildDatabaseInputSchema = z.object({
  id: z.string().min(1, "Resource ID is required"),
  confirm: z.literal(true, {
    message: "Database rebuild requires confirmation",
  }),
});

export type RebuildDatabaseInput = z.infer<typeof RebuildDatabaseInputSchema>;

/** Recreate a database service and managed volume after an explicit confirmation. */
export class RebuildDatabaseUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly defaultDockerService: DockerService,
  ) {}

  async execute(input: RebuildDatabaseInput): Promise<Resource> {
    const resource = await this.uow.resourceRepository.findById(input.id);
    if (!resource) throw new Error("Resource not found");
    if (resource.type !== "database") {
      throw new Error("Only database resources can be rebuilt");
    }

    const deploymentId = `dep-${randomUUID()}`;
    const startedAt = new Date();
    await this.uow.deploymentRepository.create({
      id: deploymentId,
      resourceId: resource.id,
      status: "running",
      title: "Database rebuild",
      logs: "Database rebuild requested. Existing managed data will be removed.\n",
      serverId: resource.serverId,
    });

    try {
      return await this.uow.transaction(async (tx) => {
        const { dockerService, cleanup } = await resolveDockerServiceForServer(
          resource.serverId,
          tx,
          this.defaultDockerService,
        );
        try {
          await dockerService.removeDatabase(resource);
          await dockerService.deployDatabase(
            resource,
            getDatabaseEnvironment(resource),
          );
          const logs = `Database rebuild completed at ${new Date().toISOString()}.\n`;

          await tx.deploymentRepository.updateById(deploymentId, {
            status: "success",
            logs: `Database rebuild started at ${startedAt.toISOString()}.\n${logs}`,
          });

          const updated = await tx.resourceRepository.updateById(resource.id, {
            status: "running",
          });
          if (!updated) throw new Error("Resource could not be updated");
          return updated;
        } finally {
          cleanup();
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.uow.deploymentRepository.updateById(deploymentId, {
        status: "failed",
        logs: `Database rebuild failed: ${message}\n`,
      });
      throw error;
    }
  }
}
