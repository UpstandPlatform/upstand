import { randomUUID } from "node:crypto";
import {
  type IUnitOfWork,
  type Resource,
  ValidationError,
} from "@upstand/domain";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import { z } from "zod";
import type { DockerRegistryAuth } from "../ports/docker";
import type { DockerResourceControlService as DockerService } from "./docker-client";
import { resolveDockerServiceForServer } from "./docker-client";

export const RollbackResourceInputSchema = z.object({
  id: z.string().min(1, "Resource ID is required"),
  deploymentId: z.string().min(1).optional(),
});

export type RollbackResourceInput = z.infer<typeof RollbackResourceInputSchema>;

/** Roll back a Swarm service and persist the action in deployment history. */
export class RollbackResourceUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly defaultDockerService: DockerService,
  ) {}

  async execute(input: RollbackResourceInput): Promise<Resource> {
    const resource = await this.uow.resourceRepository.findById(input.id);
    if (!resource) throw new ValidationError("Resource not found");
    if (resource.type === "compose") {
      throw new ValidationError(
        "Compose resources do not support service rollback; deploy the desired Compose revision instead.",
      );
    }

    const deploymentId = `dep-${randomUUID()}`;
    const startedAt = new Date();
    await this.uow.deploymentRepository.create({
      id: deploymentId,
      resourceId: resource.id,
      status: "running",
      title: "Swarm service rollback",
      logs: `Rollback requested for ${resource.appName || resource.name}.\n`,
      serverId: resource.serverId,
    });

    try {
      const result = await this.uow.transaction(async (tx) => {
        const { dockerService, cleanup } = await resolveDockerServiceForServer(
          resource.serverId,
          tx,
          this.defaultDockerService,
        );
        try {
          let registryAuth: DockerRegistryAuth | undefined;
          if (resource.rollbackActive && resource.rollbackRegistryId) {
            const registry = await tx.dockerRegistryRepository.findById(
              resource.rollbackRegistryId,
            );
            const environment = await tx.environmentRepository.findById(
              resource.environmentId,
            );
            const project = environment
              ? await tx.projectRepository.findById(environment.projectId)
              : null;
            if (
              !registry ||
              !project ||
              registry.organizationId !== project.organizationId
            ) {
              throw new ValidationError(
                "Selected rollback registry is not available to this organization",
              );
            }

            let password = "";
            if (registry.password) {
              try {
                const payload = JSON.parse(registry.password);
                password =
                  payload.ciphertext && payload.iv && payload.authTag
                    ? decryptSecret(payload)
                    : registry.password;
              } catch {
                // Keep compatibility with legacy registries that predate
                // encrypted password storage.
                password = registry.password;
              }
            }
            registryAuth = {
              username: registry.username || undefined,
              password,
              serveraddress: (registry.registryUrl || "").replace(
                /^https?:\/\//,
                "",
              ),
            };
          }
          await dockerService.rollbackService(resource, registryAuth);
          const logs = `Rollback completed at ${new Date().toISOString()}.\n`;
          await tx.deploymentRepository.updateById(deploymentId, {
            status: "success",
            logs: `Rollback requested at ${startedAt.toISOString()}.\n${logs}`,
          });

          const updated = await tx.resourceRepository.updateById(resource.id, {
            status: "running",
          });
          if (!updated)
            throw new ValidationError("Resource could not be updated");
          return updated;
        } finally {
          cleanup();
        }
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.uow.deploymentRepository.updateById(deploymentId, {
        status: "failed",
        logs: `Rollback failed: ${message}\n`,
      });
      throw error;
    }
  }
}
