import {
  ApplicationBuildConfigSchema,
  EntityIconSchema,
  type IUnitOfWork,
  isSupportedDatabaseImage,
  parseDomainMappings,
  parseResourceAdvancedConfig,
  type Resource,
  ResourceAppNameSchema,
  ResourceComposeTypeSchema,
  serializeApplicationBuildConfig,
  serializeDomainMappings,
  serializeResourceAdvancedConfig,
  ValidationError,
} from "@upstand/domain";
import {
  decryptSecret,
  encryptSecret,
} from "@upstand/platform/crypto/secret-box";
import { log } from "evlog";
import { z } from "zod";
import { requiresRemoteServerPlacement } from "../platform/platform.types";
import {
  assertBuildServerSupportsResource,
  assertDeploymentServerSupportsResource,
  assertResourceCanUseBuildServer,
} from "../server/server-role";
import type { CaddyService } from "../web-server/caddy.service";
import { createRemoteServices } from "./docker-client";
import { validateLibsqlSettings } from "./libsql-settings";
import { serializeResourceCredentials } from "./resource-credentials";
import { serializeResourceEnvironmentVariables } from "./resource-environment";
import { ResourcePreviewFieldsSchema } from "./resource-preview-fields.schema";
import { validateResourceCredentialReferences } from "./validate-resource-credential-references";

export const UpdateResourceInputSchema = z
  .object({
    id: z.string().min(1, "Resource ID is required"),
    organizationId: z.string().min(1, "Organization ID is required").optional(),
    name: z.string().optional(),
    status: z.enum(["running", "stopped"]).optional(),
    appName: ResourceAppNameSchema.optional(),
    description: z.string().optional(),
    provider: z.string().optional(),
    dbType: z.string().optional(),
    dockerImage: z.string().optional(),
    buildRegistryId: z.string().nullable().optional(),
    rollbackActive: z.boolean().optional(),
    rollbackRegistryId: z.string().nullable().optional(),
    allowCustomImage: z.boolean().optional(),
    externalPort: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .nullable()
      .optional(),
    libsqlGrpcPort: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .nullable()
      .optional(),
    libsqlAdminPort: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .nullable()
      .optional(),
    composeType: ResourceComposeTypeSchema.optional(),
    credentials: z.string().optional(),
    triggerType: z.enum(["push", "tag"]).optional(),
    tagPattern: z.string().trim().max(512).nullable().optional(),
    watchPaths: z.array(z.string().trim().min(1).max(512)).max(64).optional(),
    buildConfig: ApplicationBuildConfigSchema.optional(),
    buildSecrets: z.string().optional(),
    buildEnvVars: z.string().optional(),
    advancedConfig: z.string().optional(),
    envVars: z.string().optional(),
    domains: z.string().optional(),
    serverId: z.string().nullable().optional(),
    buildServerId: z.string().nullable().optional(),
    cronJobsEnabled: z.boolean().optional(),
    icon: EntityIconSchema,
  })
  .extend(ResourcePreviewFieldsSchema.shape);

export type UpdateResourceInput = z.infer<typeof UpdateResourceInputSchema>;

export class UpdateResourceUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly caddyService: CaddyService,
  ) {}

  async execute(input: UpdateResourceInput): Promise<Resource | null> {
    const resource = await this.uow.resourceRepository.findById(input.id);
    if (!resource) {
      throw new ValidationError("Resource not found");
    }
    const resourceEnvironment = await this.uow.environmentRepository.findById(
      resource.environmentId,
    );
    const resourceProject = resourceEnvironment
      ? await this.uow.projectRepository.findById(resourceEnvironment.projectId)
      : null;
    if (
      !resourceProject ||
      !input.organizationId ||
      resourceProject.organizationId !== input.organizationId
    ) {
      throw new ValidationError("Resource not found");
    }

    const patch: Partial<Resource> = {};
    if (input.icon !== undefined) {
      patch.icon = input.icon;
    }
    if (input.cronJobsEnabled !== undefined) {
      patch.cronJobsEnabled = input.cronJobsEnabled;
    }
    validateLibsqlSettings(
      input.dbType ?? resource.dbType ?? undefined,
      input.libsqlGrpcPort,
      input.libsqlAdminPort,
      (input.dbType ?? resource.dbType)?.toLowerCase() === "libsql"
        ? (input.externalPort ?? resource.externalPort)
        : undefined,
    );
    if (input.name !== undefined) patch.name = input.name;
    if (input.status !== undefined) patch.status = input.status;
    if (input.appName !== undefined) {
      const duplicate =
        await this.uow.resourceRepository.checkDuplicateServiceKey(
          input.appName,
          resource.id,
        );
      if (duplicate) {
        throw new ValidationError(
          `Docker service name '${input.appName}' is already used by resource '${duplicate.name}'. Choose a unique service name across the Swarm cluster.`,
        );
      }
      patch.appName = input.appName;
    }
    if (input.description !== undefined) patch.description = input.description;
    if (input.provider !== undefined) patch.provider = input.provider;
    if (input.dbType !== undefined) {
      if (resource.type !== "database") {
        throw new ValidationError(
          "Database engine can only be changed on database resources",
        );
      }
      patch.dbType = input.dbType;
    }
    if (input.dockerImage !== undefined) {
      if (resource.type === "database") {
        const dbType = input.dbType ?? resource.dbType ?? undefined;
        if (
          !isSupportedDatabaseImage(
            dbType,
            input.dockerImage,
            input.allowCustomImage === true,
          )
        ) {
          throw new ValidationError(
            "Select a supported database image version for the selected database engine",
          );
        }
      } else if (resource.type !== "application") {
        throw new ValidationError(
          "Docker images can only be changed on application or database resources",
        );
      } else if (!input.dockerImage.trim()) {
        throw new ValidationError(
          "Docker image is required for application resources",
        );
      }
      patch.dockerImage = input.dockerImage.trim();
    }
    if (
      resource.type === "database" &&
      input.dbType !== undefined &&
      input.dbType.toLowerCase() !== "libsql"
    ) {
      patch.libsqlGrpcPort = null;
      patch.libsqlAdminPort = null;
    }
    if (input.externalPort !== undefined) {
      if (resource.type !== "database") {
        throw new ValidationError(
          "External port can only be changed on database resources",
        );
      }
      patch.externalPort = input.externalPort;
    }
    if (
      input.libsqlGrpcPort !== undefined ||
      input.libsqlAdminPort !== undefined
    ) {
      if (resource.type !== "database") {
        throw new ValidationError(
          "libSQL ports can only be changed on database resources",
        );
      }
      if (
        (input.dbType ?? resource.dbType)?.toLowerCase() !== "libsql" &&
        [input.libsqlGrpcPort, input.libsqlAdminPort].some(
          (port) => port !== null && port !== undefined,
        )
      ) {
        throw new ValidationError(
          "libSQL ports can only be configured for libSQL resources",
        );
      }
      if (input.libsqlGrpcPort !== undefined) {
        patch.libsqlGrpcPort = input.libsqlGrpcPort;
      }
      if (input.libsqlAdminPort !== undefined) {
        patch.libsqlAdminPort = input.libsqlAdminPort;
      }
    }
    if (input.buildRegistryId !== undefined) {
      if (resource.type !== "application") {
        throw new ValidationError(
          "Build registry settings are only supported on application resources",
        );
      }
      const environment = await this.uow.environmentRepository.findById(
        resource.environmentId,
      );
      const project = environment
        ? await this.uow.projectRepository.findById(environment.projectId)
        : null;
      if (!project) throw new ValidationError("Project not found");
      if (input.buildRegistryId) {
        const registry = await this.uow.dockerRegistryRepository.findById(
          input.buildRegistryId,
        );
        if (!registry || registry.organizationId !== project.organizationId) {
          throw new ValidationError(
            "Selected build registry is not available to this organization",
          );
        }
      }
      patch.buildRegistryId = input.buildRegistryId;
    }
    if (
      input.rollbackActive !== undefined ||
      input.rollbackRegistryId !== undefined
    ) {
      if (resource.type !== "application") {
        throw new ValidationError(
          "Rollback registry settings are only supported on application resources",
        );
      }
      const environment = await this.uow.environmentRepository.findById(
        resource.environmentId,
      );
      const project = environment
        ? await this.uow.projectRepository.findById(environment.projectId)
        : null;
      if (!project) throw new ValidationError("Project not found");

      const rollbackRegistryId =
        input.rollbackRegistryId !== undefined
          ? input.rollbackRegistryId
          : resource.rollbackRegistryId;
      const willBeActive =
        input.rollbackActive !== undefined
          ? input.rollbackActive
          : resource.rollbackActive;

      if (willBeActive) {
        if (!rollbackRegistryId) {
          throw new ValidationError(
            "A Docker registry must be selected to enable rollbacks",
          );
        }
        const registry =
          await this.uow.dockerRegistryRepository.findById(rollbackRegistryId);
        if (!registry || registry.organizationId !== project.organizationId) {
          throw new ValidationError(
            "Selected rollback registry is not available to this organization",
          );
        }
      }
      if (input.rollbackActive !== undefined)
        patch.rollbackActive = input.rollbackActive;
      if (input.rollbackRegistryId !== undefined)
        patch.rollbackRegistryId = input.rollbackRegistryId;
    }
    if (input.composeType !== undefined) {
      if (resource.type !== "compose") {
        throw new ValidationError(
          "Compose deployment mode can only be changed on Compose resources",
        );
      }
      patch.composeType = input.composeType;
    }
    if (input.credentials !== undefined) {
      const environment = await this.uow.environmentRepository.findById(
        resource.environmentId,
      );
      const project = environment
        ? await this.uow.projectRepository.findById(environment.projectId)
        : null;
      if (!project) throw new ValidationError("Project not found");
      await validateResourceCredentialReferences(
        this.uow,
        project.organizationId,
        input.credentials,
      );
      try {
        patch.credentials = serializeResourceCredentials(input.credentials);
      } catch (error: unknown) {
        log.error({
          message: "Failed to encrypt resource credentials",
          err: error,
        });
        throw new ValidationError(
          "Resource credentials could not be encrypted",
        );
      }
    }
    if (input.triggerType !== undefined) {
      if (resource.type !== "application" && resource.type !== "compose") {
        throw new ValidationError(
          "Trigger settings can only be changed on application or compose resources",
        );
      }
      patch.triggerType = input.triggerType;
    }
    if (input.tagPattern !== undefined) {
      if (resource.type !== "application" && resource.type !== "compose") {
        throw new ValidationError(
          "Tag pattern can only be changed on application or compose resources",
        );
      }
      patch.tagPattern = input.tagPattern;
    }
    if (input.watchPaths !== undefined) {
      if (resource.type !== "application" && resource.type !== "compose") {
        throw new ValidationError(
          "Watch paths can only be changed on application or compose resources",
        );
      }
      patch.watchPaths = JSON.stringify(input.watchPaths);
    }
    if (input.envVars !== undefined) {
      patch.envVars = serializeResourceEnvironmentVariables(input.envVars);
    }
    if (input.advancedConfig !== undefined) {
      try {
        patch.advancedConfig = serializeResourceAdvancedConfig(
          parseResourceAdvancedConfig(input.advancedConfig),
        );
      } catch (error) {
        throw new ValidationError(
          `Invalid advanced resource configuration: ${error instanceof Error ? error.message : "unknown validation error"}`,
        );
      }
    }
    if (input.buildConfig !== undefined) {
      if (resource.type !== "application") {
        throw new ValidationError(
          "Build configuration is only supported by application resources",
        );
      }
      patch.buildConfig = serializeApplicationBuildConfig(input.buildConfig);
    }
    if (input.buildSecrets !== undefined) {
      if (resource.type !== "application") {
        throw new ValidationError(
          "Build secrets can only be changed on application resources",
        );
      }
      try {
        patch.buildSecrets = input.buildSecrets
          ? JSON.stringify(encryptSecret(input.buildSecrets))
          : null;
      } catch (error) {
        log.error({
          message: "Failed to encrypt application build secrets",
          err: error,
        });
        throw new ValidationError(
          "Application build secrets could not be encrypted",
        );
      }
    }
    if (input.buildEnvVars !== undefined) {
      if (resource.type !== "application") {
        throw new ValidationError(
          "Build environment variables can only be changed on application resources",
        );
      }
      patch.buildEnvVars = serializeResourceEnvironmentVariables(
        input.buildEnvVars,
      );
    }
    if (
      input.isPreviewDeploymentsActive !== undefined ||
      input.previewLimit !== undefined ||
      input.previewWildcard !== undefined ||
      input.previewHttps !== undefined ||
      input.previewPort !== undefined
    ) {
      if (resource.type !== "application") {
        throw new ValidationError(
          "Preview deployment settings can only be changed on applications",
        );
      }
      if (input.isPreviewDeploymentsActive !== undefined)
        patch.isPreviewDeploymentsActive = input.isPreviewDeploymentsActive;
      if (input.previewLimit !== undefined)
        patch.previewLimit = input.previewLimit;
      if (input.previewWildcard !== undefined)
        patch.previewWildcard = input.previewWildcard;
      if (input.previewHttps !== undefined)
        patch.previewHttps = input.previewHttps;
      if (input.previewPort !== undefined)
        patch.previewPort = input.previewPort;
    }
    if (input.domains !== undefined) {
      try {
        const mappings = parseDomainMappings(input.domains);
        const customCertificateIds = mappings
          .filter((mapping) => mapping.certificateType === "custom")
          .map((mapping) => mapping.certificateId)
          .filter((id): id is string => Boolean(id));
        if (customCertificateIds.length > 0) {
          const environment = await this.uow.environmentRepository.findById(
            resource.environmentId,
          );
          const project = environment
            ? await this.uow.projectRepository.findById(environment.projectId)
            : null;
          if (!project) throw new ValidationError("Project not found");
          for (const certificateId of new Set(customCertificateIds)) {
            const certificate =
              await this.uow.certificateRepository.findById(certificateId);
            if (
              !certificate ||
              certificate.organizationId !== project.organizationId
            ) {
              throw new ValidationError(
                "Selected certificate is not available to this organization",
              );
            }
          }
        }
        patch.domains = serializeDomainMappings(mappings);
      } catch (error) {
        throw new ValidationError(
          `Invalid domain configuration: ${error instanceof Error ? error.message : "unknown validation error"}`,
        );
      }
    }
    if (input.serverId !== undefined) {
      const currentServerId =
        !resource.serverId || ["local", "manager"].includes(resource.serverId)
          ? null
          : resource.serverId;
      const requestedServerId =
        !input.serverId || ["local", "manager"].includes(input.serverId)
          ? null
          : input.serverId;
      if (currentServerId !== requestedServerId) {
        throw new ValidationError(
          "Changing workload placement requires the durable server migration workflow.",
        );
      }
    }
    if (requiresRemoteServerPlacement()) {
      if (
        input.serverId === null ||
        (input.serverId && ["local", "manager"].includes(input.serverId))
      ) {
        throw new ValidationError(
          "Please select a target server for deployment.",
        );
      }
    }
    if (input.serverId !== undefined || input.buildServerId !== undefined) {
      if (input.buildServerId) {
        assertResourceCanUseBuildServer(resource.type);
      }
      const environment = await this.uow.environmentRepository.findById(
        resource.environmentId,
      );
      const project = environment
        ? await this.uow.projectRepository.findById(environment.projectId)
        : null;
      if (!project) throw new ValidationError("Project not found");

      const validateServer = async (
        serverId: string | null | undefined,
        assignment: "build" | "deployment",
      ) => {
        if (!serverId || ["local", "manager"].includes(serverId)) return;
        const server = await this.uow.serverRepository.findById(serverId);
        if (!server || server.organizationId !== project.organizationId) {
          throw new ValidationError(
            "Selected server is not available to this organization",
          );
        }
        if (assignment === "build") {
          assertBuildServerSupportsResource(server, resource.type);
        } else {
          assertDeploymentServerSupportsResource(server, resource.type);
        }
      };
      await validateServer(input.serverId, "deployment");
      await validateServer(input.buildServerId, "build");
      if (input.serverId !== undefined) {
        patch.serverId =
          !input.serverId || ["local", "manager"].includes(input.serverId)
            ? null
            : input.serverId;
      }
      if (input.buildServerId !== undefined) {
        patch.buildServerId =
          !input.buildServerId ||
          ["local", "manager"].includes(input.buildServerId)
            ? null
            : input.buildServerId;
      }
    }

    const routingChanged =
      input.domains !== undefined ||
      input.appName !== undefined ||
      input.name !== undefined ||
      input.advancedConfig !== undefined;
    const candidate = { ...resource, ...patch } as Resource;

    const serverId = resource.serverId;
    const resources = routingChanged
      ? this.uow.resourceRepository.findForCaddyByDeploymentServerId
        ? await this.uow.resourceRepository.findForCaddyByDeploymentServerId(
            serverId,
          )
        : this.uow.resourceRepository.findByDeploymentServerId
          ? await this.uow.resourceRepository.findByDeploymentServerId(serverId)
          : await this.uow.resourceRepository.findMany()
      : [];
    const certificates =
      (await this.uow.certificateRepository.findAll?.()) ?? [];
    const sameServerResources =
      serverId && !["local", "manager"].includes(serverId)
        ? resources.filter((c) => c.serverId === serverId)
        : resources.filter(
            (c) =>
              !c.serverId || c.serverId === "local" || c.serverId === "manager",
          );

    const existingResources = routingChanged ? sameServerResources : [];
    const candidateResources = routingChanged
      ? sameServerResources.map((item) =>
          item.id === resource.id ? candidate : item,
        )
      : [];
    const settings = routingChanged
      ? await this.uow.webServerSettingsRepository.findGlobal()
      : null;

    let caddyService = this.caddyService;
    if (
      routingChanged &&
      serverId &&
      !["local", "manager"].includes(serverId)
    ) {
      const server = await this.uow.serverRepository.findById(serverId);
      if (server) {
        let privateKey: string | undefined;
        let password: string | undefined;
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
            throw new Error(
              "Target deployment server password credentials missing",
            );
          }
          password = decryptSecret({
            ciphertext: server.passwordCiphertext,
            iv: server.passwordIv,
            authTag: server.passwordAuthTag,
            keyVersion: server.passwordVersion,
          });
        } else {
          if (!server.sshKeyId) {
            throw new Error(
              "Target deployment server has no SSH key configured",
            );
          }
          const sshKey = await this.uow.sshKeyRepository.findById(
            server.sshKeyId,
          );
          if (!sshKey) {
            throw new Error("Target deployment server SSH key not found");
          }
          privateKey = decryptSecret({
            ciphertext: sshKey.privateKeyCiphertext,
            iv: sshKey.privateKeyIv,
            authTag: sshKey.privateKeyAuthTag,
            keyVersion: sshKey.privateKeyVersion,
          });
        }
        const connection = {
          host: server.ipAddress,
          port: server.port,
          username: server.username,
          privateKey,
          password,
          hostKeyFingerprint: server.sshHostKeyFingerprint ?? undefined,
        };
        caddyService = createRemoteServices(connection).caddyService;
      }
    }

    // Apply the fully validated Caddy configuration before committing the metadata.
    // If the database write fails, immediately restore the previous known-good config.
    if (routingChanged) {
      await caddyService.syncResourceConfigs(
        candidateResources,
        settings || {},
        certificates,
      );
    }

    try {
      return await this.uow.transaction(async (tx) => {
        const updateIfUnchanged = tx.resourceRepository.updateByIdIfUpdatedAt;
        if (updateIfUnchanged) {
          const updated = await updateIfUnchanged.call(
            tx.resourceRepository,
            input.id,
            resource.updatedAt,
            patch,
          );
          if (!updated) {
            throw new ValidationError(
              "Resource changed while it was being updated. Retry the operation.",
            );
          }
          return updated;
        }

        // Compatibility for lightweight test/in-memory repositories that do
        // not implement the production compare-and-set operation.
        return tx.resourceRepository.updateById(input.id, patch);
      });
    } catch (error) {
      if (routingChanged) {
        try {
          await caddyService.syncResourceConfigs(
            existingResources,
            settings || {},
            certificates,
          );
        } catch (rollbackError) {
          log.error({
            message: "Failed to restore Caddy after resource update rollback",
            err:
              rollbackError instanceof Error
                ? rollbackError.message
                : rollbackError,
          });
        }
      }
      throw error;
    }
  }
}
