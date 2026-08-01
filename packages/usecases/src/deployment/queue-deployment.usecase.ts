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
import { parseResourceCredentials } from "../resource/resource-credentials";

const GIT_SOURCE_PROVIDERS = new Set([
  "github",
  "gitlab",
  "bitbucket",
  "gitea",
]);

function stringField(
  value: Record<string, unknown>,
  field: string,
): string | undefined {
  const candidate = value[field];
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : undefined;
}

function parseProviderConfig(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function validateDeploymentSource(
  uow: IUnitOfWork,
  resource: Resource,
): Promise<void> {
  const credentials = parseResourceCredentials(resource.credentials);

  if (resource.type === "database") return;

  if (resource.type === "compose" && resource.provider === "raw") {
    if (!stringField(credentials, "composeFile")) {
      throw new ValidationError(
        "Compose file is missing. Add compose content before deploying.",
      );
    }
    return;
  }

  if (resource.provider === "docker-registry") {
    if (!resource.dockerImage?.trim()) {
      throw new ValidationError(
        "Docker image is missing. Configure an image before deploying.",
      );
    }
    return;
  }

  if (GIT_SOURCE_PROVIDERS.has(resource.provider)) {
    const providerId = stringField(credentials, "githubAccount");
    if (!providerId) {
      throw new ValidationError(
        "Git provider is not associated. Configure a repository connection before deploying.",
      );
    }
    const provider = await uow.gitProviderRepository.findById(providerId);
    if (!provider) {
      throw new ValidationError(
        "Associated Git provider was not found. Select a valid repository connection before deploying.",
      );
    }
    if (!stringField(credentials, "repository")) {
      throw new ValidationError(
        "Repository is missing. Select a repository before deploying.",
      );
    }
    return;
  }

  if (resource.provider === "git") {
    if (!stringField(credentials, "repositoryUrl")) {
      throw new ValidationError(
        "Repository URL is missing. Configure a repository before deploying.",
      );
    }
    return;
  }

  if (resource.provider === "generic") {
    if (resource.type !== "compose") {
      throw new ValidationError(
        "Generic Git deployments are only supported for Compose resources.",
      );
    }
    const providerId = stringField(credentials, "githubAccount");
    if (!providerId) {
      throw new ValidationError(
        "Git provider is not associated. Configure a repository connection before deploying.",
      );
    }
    const provider = await uow.gitProviderRepository.findById(providerId);
    if (!provider) {
      throw new ValidationError(
        "Associated Git provider was not found. Select a valid repository connection before deploying.",
      );
    }
    if (!stringField(credentials, "repository")) {
      throw new ValidationError(
        "Repository is missing. Select a repository before deploying.",
      );
    }
    const providerConfig = parseProviderConfig(provider.config);
    if (
      !stringField(credentials, "repositoryUrl") &&
      !stringField(providerConfig, "gitUrl")
    ) {
      throw new ValidationError(
        "Repository URL is missing. Configure a repository before deploying.",
      );
    }
    return;
  }

  if (resource.provider === "drop") return;

  throw new ValidationError(
    `Unsupported deployment provider: ${resource.provider}`,
  );
}

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
    name: "Upstand Server",
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
      await validateDeploymentSource(tx, resource);
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
      let serverName = "Upstand Server";
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
        // Fetch server name and validate server status & credentials
        const server = await tx.serverRepository.findById(serverId);
        if (server) {
          serverName = server.name;
          serverIp = server.ipAddress;
          if (server.status !== "ready") {
            throw new ValidationError(
              `Target server '${server.name}' is not ready (${server.status}). Run server setup before deploying.`,
            );
          }
          const isPasswordAuth =
            server.authType === "password" ||
            (!server.sshKeyId && Boolean(server.passwordCiphertext));
          if (isPasswordAuth) {
            if (
              !server.passwordCiphertext ||
              !server.passwordIv ||
              !server.passwordAuthTag ||
              server.passwordVersion == null
            ) {
              throw new ValidationError(
                `Target server '${server.name}' has no password credentials configured. Please update server authentication.`,
              );
            }
          } else {
            if (!server.sshKeyId) {
              throw new ValidationError(
                `Target server '${server.name}' has no SSH key configured. Please attach an SSH key.`,
              );
            }
          }
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
