import { randomUUID } from "node:crypto";
import {
  ApplicationBuildConfigSchema,
  DEFAULT_APPLICATION_BUILD_CONFIG,
  DEFAULT_RESOURCE_ADVANCED_CONFIG,
  DomainMappingSchema,
  type IUnitOfWork,
  isSupportedDatabaseImage,
  type Resource,
  ResourceAdvancedConfigSchema,
  ResourceAppNameSchema,
  ResourceComposeTypeSchema,
  serializeApplicationBuildConfig,
  serializeDomainMappings,
  serializeResourceAdvancedConfig,
  ValidationError,
} from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import { log } from "evlog";
import { z } from "zod";
import { requiresRemoteServerPlacement } from "../platform/platform.types";
import {
  assertBuildServerSupportsResource,
  assertDeploymentServerSupportsResource,
  assertResourceCanUseBuildServer,
} from "../server/server-role";
import { ensureManagedDatabaseCredentials } from "./database-credentials";
import { validateLibsqlSettings } from "./libsql-settings";
import {
  parseResourceCredentialInput,
  serializeResourceCredentials,
} from "./resource-credentials";
import {
  ResourceEnvironmentVariablesSchema,
  serializeResourceEnvironmentVariables,
} from "./resource-environment";
import { ResourcePreviewFieldsSchema } from "./resource-preview-fields.schema";
import { validateResourceCredentialReferences } from "./validate-resource-credential-references";
import { generateWebhookToken } from "./webhook-token";

export const CreateResourceInputSchema = z
  .object({
    environmentId: z.string().min(1, "Environment ID is required"),
    name: z.string().min(1, "Resource name is required"),
    type: z.enum(["application", "database", "compose"]),
    appName: ResourceAppNameSchema,
    description: z.string().optional(),
    dbType: z.string().optional(),
    composeType: ResourceComposeTypeSchema.optional(),
    dockerImage: z.string().optional(),
    buildRegistryId: z.string().nullable().optional(),
    rollbackActive: z.boolean().optional(),
    rollbackRegistryId: z.string().nullable().optional(),
    allowCustomImage: z.boolean().optional(),
    externalPort: z.coerce.number().int().min(1).max(65535).optional(),
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
    credentials: z.string().optional(),
    triggerType: z.enum(["push", "tag"]).optional(),
    tagPattern: z.string().trim().max(512).nullable().optional(),
    watchPaths: z.array(z.string().trim().min(1).max(512)).max(64).optional(),
    buildConfig: ApplicationBuildConfigSchema.optional(),
    buildSecrets: z.string().optional(),
    buildEnvVars: ResourceEnvironmentVariablesSchema.optional(),
    serverId: z.string().optional(),
    buildServerId: z.string().nullable().optional(),
    advancedConfig: ResourceAdvancedConfigSchema.optional(),
    envVars: ResourceEnvironmentVariablesSchema.optional(),
    domains: z.array(DomainMappingSchema).optional(),
  })
  .extend(ResourcePreviewFieldsSchema.shape);

export type CreateResourceInput = z.infer<typeof CreateResourceInputSchema>;

export class CreateResourceUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: CreateResourceInput): Promise<Resource> {
    if (requiresRemoteServerPlacement()) {
      if (!input.serverId || ["local", "manager"].includes(input.serverId)) {
        throw new ValidationError(
          "Please select a target server for deployment.",
        );
      }
    }
    validateLibsqlSettings(
      input.dbType,
      input.libsqlGrpcPort,
      input.libsqlAdminPort,
      input.dbType?.toLowerCase() === "libsql" ? input.externalPort : undefined,
    );
    if (
      input.type === "database" &&
      !isSupportedDatabaseImage(
        input.dbType,
        input.dockerImage,
        input.allowCustomImage === true,
      )
    ) {
      throw new ValidationError(
        "Select a supported database image version for the selected database engine",
      );
    }

    return this.uow.transaction(async (tx) => {
      const environment = await tx.environmentRepository.findById(
        input.environmentId,
      );
      if (!environment) {
        throw new ValidationError("Environment not found");
      }

      if (input.credentials !== undefined) {
        const project = await tx.projectRepository.findById(
          environment.projectId,
        );
        if (!project) throw new ValidationError("Project not found");
        await validateResourceCredentialReferences(
          tx,
          project.organizationId,
          input.credentials,
        );
      }

      if (input.rollbackActive || input.rollbackRegistryId) {
        if (input.type !== "application") {
          throw new ValidationError(
            "Rollback registry settings are only supported on application resources",
          );
        }
        if (input.rollbackRegistryId) {
          const project = await tx.projectRepository.findById(
            environment.projectId,
          );
          if (!project) throw new ValidationError("Project not found");
          const registry = await tx.dockerRegistryRepository.findById(
            input.rollbackRegistryId,
          );
          if (!registry || registry.organizationId !== project.organizationId) {
            throw new ValidationError(
              "Selected rollback registry is not available to this organization",
            );
          }
        }
      }

      if (input.buildRegistryId) {
        if (input.type !== "application") {
          throw new ValidationError(
            "Build registry settings are only supported on application resources",
          );
        }
        const project = await tx.projectRepository.findById(
          environment.projectId,
        );
        if (!project) throw new ValidationError("Project not found");
        const registry = await tx.dockerRegistryRepository.findById(
          input.buildRegistryId,
        );
        if (!registry || registry.organizationId !== project.organizationId) {
          throw new ValidationError(
            "Selected build registry is not available to this organization",
          );
        }
      }

      const customCertificateIds = (input.domains ?? [])
        .filter((mapping) => mapping.certificateType === "custom")
        .map((mapping) => mapping.certificateId)
        .filter((id): id is string => Boolean(id));
      if (customCertificateIds.length > 0) {
        const project = await tx.projectRepository.findById(
          environment.projectId,
        );
        if (!project) throw new ValidationError("Project not found");
        for (const certificateId of new Set(customCertificateIds)) {
          const certificate =
            await tx.certificateRepository.findById(certificateId);
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

      if (requiresRemoteServerPlacement()) {
        if (!input.serverId || ["local", "manager"].includes(input.serverId)) {
          throw new ValidationError(
            "Local server deployments are disabled in Cloud mode. Please select a valid remote server.",
          );
        }
        if (
          input.buildServerId &&
          ["local", "manager"].includes(input.buildServerId)
        ) {
          throw new ValidationError(
            "Local build server operations are disabled in Cloud mode. Please select a valid remote server.",
          );
        }
      }

      if (input.buildServerId) {
        assertResourceCanUseBuildServer(input.type);
      }

      if (
        [input.serverId, input.buildServerId].some(
          (serverId) => serverId && !["local", "manager"].includes(serverId),
        )
      ) {
        const project = await tx.projectRepository.findById(
          environment.projectId,
        );
        if (!project) {
          throw new ValidationError("Project not found");
        }
        const validateServer = async (
          serverId: string | null | undefined,
          assignment: "build" | "deployment",
        ) => {
          if (!serverId || ["local", "manager"].includes(serverId)) return;
          const server = await tx.serverRepository.findById(serverId);
          if (!server || server.organizationId !== project.organizationId) {
            throw new ValidationError(
              "Selected server is not available to this organization",
            );
          }
          if (assignment === "build") {
            assertBuildServerSupportsResource(server, input.type);
          } else {
            assertDeploymentServerSupportsResource(server, input.type);
          }
        };
        await validateServer(input.serverId, "deployment");
        await validateServer(input.buildServerId, "build");
      }

      const duplicate = await tx.resourceRepository.checkDuplicateServiceKey(
        input.appName,
      );
      if (duplicate) {
        throw new ValidationError(
          `Docker service name '${input.appName}' is already used by resource '${duplicate.name}'. Choose a unique service name across the Swarm cluster.`,
        );
      }

      // Prefill provider and initial metadata
      let provider = "github";
      if (input.type === "database") {
        provider = input.dockerImage || input.dbType || "docker-registry";
      } else if (input.type === "application" && input.dockerImage) {
        provider = "docker-registry";
      } else if (input.type === "compose") {
        provider = "raw";
      }

      let credentials = input.credentials ?? null;
      const sourceConfig = parseResourceCredentialInput(input.credentials);
      if (typeof sourceConfig.registryId === "string") {
        const registry = await tx.dockerRegistryRepository.findById(
          sourceConfig.registryId,
        );
        const project = await tx.projectRepository.findById(
          environment.projectId,
        );
        if (
          !registry ||
          !project ||
          registry.organizationId !== project.organizationId
        ) {
          throw new ValidationError(
            "Selected Docker registry is not available to this organization",
          );
        }
      }
      const triggerType =
        input.triggerType ??
        (String(sourceConfig.triggerType ?? "push")
          .toLowerCase()
          .includes("tag")
          ? "tag"
          : "push");
      const watchPaths =
        input.watchPaths ??
        (Array.isArray(sourceConfig.watchPaths)
          ? sourceConfig.watchPaths.filter(
              (value): value is string => typeof value === "string",
            )
          : []);
      if (input.credentials) {
        try {
          credentials = serializeResourceCredentials(input.credentials);
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

      if (input.type === "database") {
        credentials = serializeResourceCredentials(
          ensureManagedDatabaseCredentials(input.dbType, sourceConfig),
        );
      }

      const webhookToken = generateWebhookToken();
      const res = await tx.resourceRepository.create({
        id: randomUUID(),
        environmentId: input.environmentId,
        name: input.name,
        type: input.type,
        status: "idle",
        provider,
        appName: input.appName,
        description: input.description ?? null,
        dbType: input.dbType ?? null,
        composeType:
          input.type === "compose" ? (input.composeType ?? "stack") : null,
        dockerImage: input.dockerImage ?? null,
        buildRegistryId: input.buildRegistryId ?? null,
        rollbackActive:
          input.rollbackActive ?? Boolean(input.rollbackRegistryId),
        rollbackRegistryId: input.rollbackRegistryId ?? null,
        externalPort: input.externalPort ?? null,
        libsqlGrpcPort: input.libsqlGrpcPort ?? null,
        libsqlAdminPort: input.libsqlAdminPort ?? null,
        credentials,
        triggerType,
        tagPattern: input.tagPattern ?? null,
        watchPaths: JSON.stringify(watchPaths),
        webhookTokenHash: webhookToken.hash,
        webhookTokenPrefix: webhookToken.prefix,
        buildConfig: serializeApplicationBuildConfig(
          input.buildConfig ?? DEFAULT_APPLICATION_BUILD_CONFIG,
        ),
        buildSecrets: input.buildSecrets
          ? JSON.stringify(encryptSecret(input.buildSecrets))
          : null,
        buildEnvVars: serializeResourceEnvironmentVariables(
          input.buildEnvVars ?? {},
        ),
        isPreviewDeploymentsActive: input.isPreviewDeploymentsActive ?? false,
        previewLimit: input.previewLimit ?? 3,
        previewWildcard: input.previewWildcard ?? null,
        previewHttps: input.previewHttps ?? false,
        previewPort: input.previewPort ?? 3000,
        advancedConfig: serializeResourceAdvancedConfig(
          input.advancedConfig ?? DEFAULT_RESOURCE_ADVANCED_CONFIG,
        ),
        envVars: serializeResourceEnvironmentVariables(input.envVars ?? {}),
        domains: serializeDomainMappings(input.domains ?? []),
        serverId:
          !input.serverId || ["local", "manager"].includes(input.serverId)
            ? null
            : input.serverId,
        buildServerId:
          !input.buildServerId ||
          ["local", "manager"].includes(input.buildServerId)
            ? null
            : input.buildServerId,
      });

      // Increment resource count
      await tx.environmentRepository.incrementResourceCount(
        input.environmentId,
        1,
      );

      return res;
    });
  }
}
