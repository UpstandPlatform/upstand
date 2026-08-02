import type { IUnitOfWork, Resource, Server } from "@upstand/domain";
import { z } from "zod";
import { OUTBOX_COMMAND_TYPES } from "../outbox/outbox-commands";
import {
  getConfiguredControlPlaneMode,
  getPlatformCapabilities,
} from "../platform/platform.types";

export const MigrateResourceInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
  resourceId: z.string().min(1, "Resource ID is required"),
  targetServerId: z.string().min(1, "Target Server ID is required"),
});

export type MigrateResourceInput = z.infer<typeof MigrateResourceInputSchema>;

export type MigrateResourceResult = {
  resource: Resource;
  sourceServerId: string;
  targetServer: Server;
  status: "queued" | "completed";
};

export class MigrateResourceUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: MigrateResourceInput): Promise<MigrateResourceResult> {
    const mode = getConfiguredControlPlaneMode();
    const capabilities = getPlatformCapabilities(mode);

    if (!capabilities.serverMigration) {
      throw new Error(
        `Server-to-server migration is not enabled for control plane mode '${mode}'`,
      );
    }

    return this.uow.transaction(async (tx) => {
      const resource = await tx.resourceRepository.findById(input.resourceId);
      if (!resource) {
        throw new Error("Resource not found");
      }
      const environment = await tx.environmentRepository.findById(
        resource.environmentId,
      );
      const project = environment
        ? await tx.projectRepository.findById(environment.projectId)
        : null;
      if (!project || project.organizationId !== input.organizationId) {
        throw new Error("Resource not found");
      }

      const targetServer = await tx.serverRepository.findById(
        input.targetServerId,
      );
      if (
        !targetServer ||
        targetServer.organizationId !== input.organizationId
      ) {
        throw new Error("Target server not found");
      }

      const sourceServerId = resource.serverId ?? "local";
      if (sourceServerId !== "local") {
        const sourceServer = await tx.serverRepository.findById(sourceServerId);
        if (
          !sourceServer ||
          sourceServer.organizationId !== input.organizationId
        ) {
          throw new Error("Resource not found");
        }
      }

      if (targetServer.status !== "ready") {
        throw new Error(
          `Target server '${targetServer.name}' is not ready (status: ${targetServer.status})`,
        );
      }

      if (sourceServerId === input.targetServerId) {
        throw new Error("Resource is already placed on the target server");
      }

      // Record migration action in deployment tracking
      const deployment = await tx.deploymentRepository.create({
        resourceId: resource.id,
        title: `Migrate from ${sourceServerId} to ${targetServer.name}`,
        status: "queued",
        sourceRevision: `migrate:${sourceServerId}->${targetServer.id}`,
        logs: `Initiating migration pipeline for resource '${resource.name}' (${resource.id})\nSource: ${sourceServerId}\nTarget: ${targetServer.id}\n`,
      });

      // Update resource placement target
      const updatedResource = await tx.resourceRepository.updateById(
        resource.id,
        { serverId: targetServer.id },
      );

      if (!updatedResource) {
        throw new Error("Failed to update resource placement");
      }

      // Emit outbox migration event for asynchronous worker processing
      await tx.outboxRepository.create({
        id: `outbox-migrate-${deployment.id}`,
        type: OUTBOX_COMMAND_TYPES.migrate,
        idempotencyKey: `migration:${deployment.id}`,
        aggregateType: "resource",
        aggregateId: resource.id,
        payload: {
          deploymentId: deployment.id,
          resourceId: resource.id,
          sourceServerId,
          targetServerId: targetServer.id,
          timestamp: new Date().toISOString(),
        },
      });

      return {
        resource: updatedResource,
        sourceServerId,
        targetServer,
        status: "queued",
      };
    });
  }
}
