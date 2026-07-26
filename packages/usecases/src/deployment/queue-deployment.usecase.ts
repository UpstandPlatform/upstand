import { randomUUID } from "node:crypto";
import {
  type IUnitOfWork,
  parseResourceAdvancedConfig,
  type Resource,
  ValidationError,
} from "@upstand/domain";
import {
  type DeployOutboxPayload,
  OUTBOX_COMMAND_TYPES,
} from "../outbox/outbox-commands";

export interface QueueDeploymentInput {
  resourceId: string;
  title?: string;
  previewDeploymentId?: string;
  sourceRevision?: string;
  deploymentId?: string;
}

export interface LocalDeploymentTarget {
  name: string;
  ip: string;
}

export type LocalDeploymentTargetResolver =
  () => Promise<LocalDeploymentTarget>;

const defaultLocalDeploymentTarget: LocalDeploymentTargetResolver =
  async () => ({
    name: "Dokploy Server",
    ip: "127.0.0.1",
  });

export class QueueDeploymentUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly localTargetResolver: LocalDeploymentTargetResolver = defaultLocalDeploymentTarget,
  ) {}

  async execute(input: QueueDeploymentInput): Promise<Resource> {
    return this.uow.transaction(async (tx) => {
      const resource = await tx.resourceRepository.findById(input.resourceId);
      if (!resource) {
        throw new ValidationError("Resource not found");
      }
      const environment = await tx.environmentRepository.findById(
        resource.environmentId,
      );
      const project = environment
        ? await tx.projectRepository.findById(environment.projectId)
        : null;
      if (project?.archivedAt) {
        throw new ValidationError(
          "Project is archived. Unarchive it before deploying resources.",
        );
      }
      if (
        input.sourceRevision &&
        !/^[0-9a-f]{7,64}$/i.test(input.sourceRevision)
      ) {
        throw new ValidationError("Source revision must be a commit SHA");
      }

      // 1. Resolve target serverId
      let serverId = resource.serverId;
      let serverName = "Dokploy Server";
      let serverIp = "127.0.0.1";

      if (!serverId) {
        const target = await this.localTargetResolver();
        serverName = target.name;
        serverIp = target.ip;

        // Always keep the sentinel so the deployment worker uses the local Docker socket.
        serverId = "local";

        // Save serverId on resource
        await tx.resourceRepository.updateById(resource.id, {
          serverId,
        });
      } else {
        // Fetch server name
        const server = await tx.serverRepository.findById(serverId);
        if (server) {
          serverName = server.name;
          serverIp = server.ipAddress;
        } else {
          const settings =
            await tx.serverBuildSettingsRepository.findById(serverId);
          if (settings) {
            serverName = settings.hostname;
            serverIp = settings.ip;
          }
        }
      }

      // Ensure serverBuildSettings record exists in the DB so it is listed
      const settings =
        await tx.serverBuildSettingsRepository.findById(serverId);
      if (!settings) {
        await tx.serverBuildSettingsRepository.createIfNotExists({
          id: serverId,
          hostname: serverName,
          ip: serverIp,
          concurrency: serverId === "local" || serverId === "manager" ? 2 : 1,
        });
      }

      const deploymentId = input.deploymentId || `dep-${randomUUID()}`;
      const title = input.title || "Manual deployment";
      const reliability = parseResourceAdvancedConfig(
        resource.advancedConfig,
      ).deploymentReliability;

      // 2. Create the deployment record in the database
      await tx.deploymentRepository.create({
        id: deploymentId,
        resourceId: resource.id,
        status: "queued",
        title,
        logs: "Added to queue. Waiting for slot...\n",
        serverId,
        serverName,
        sourceRevision: input.sourceRevision ?? null,
        maxAttempts: reliability.maxAttempts,
      });

      const updatedResource = await tx.resourceRepository.updateById(
        resource.id,
        {
          status: "queued",
        },
      );

      if (!updatedResource) {
        throw new Error("Failed to update resource with queued state");
      }

      const payload: DeployOutboxPayload = {
        resourceId: updatedResource.id,
        deploymentId,
        serverId,
        previewDeploymentId: input.previewDeploymentId,
        sourceRevision: input.sourceRevision,
        maxAttempts: reliability.maxAttempts,
        retryBaseSeconds: reliability.retryBaseSeconds,
        retryMaxSeconds: reliability.retryMaxSeconds,
      };
      await tx.outboxRepository.create({
        id: deploymentId,
        type: OUTBOX_COMMAND_TYPES.deploy,
        payload,
        aggregateType: "deployment",
        aggregateId: deploymentId,
        organizationId: project?.organizationId ?? null,
        idempotencyKey: `deployment:${deploymentId}`,
      });

      return updatedResource;
    });
  }
}
