import { TRPCError } from "@trpc/server";
import {
  DomainMappingSchema,
  parseApplicationBuildConfig,
  parseDomainMappings,
  parseResourceAdvancedConfig,
  type Resource,
  ResourceAdvancedConfigSchema,
} from "@upstand/domain";
import {
  CreateResourceInputSchema,
  DeleteResourceInputSchema,
  GetResourceInputSchema,
  parseResourceEnvironmentVariables,
  UpdateResourceInputSchema,
} from "@upstand/usecases";
import {
  CreateResourceUseCaseToken,
  DeleteResourceUseCaseToken,
  GetEnvironmentUseCaseToken,
  GetProjectUseCaseToken,
  UpdateResourceUseCaseToken,
} from "@upstand/usecases/tokens";
import { z } from "zod";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission } from "../permissions";
import { createResourceAuthorizer } from "./shared/resource-authorization";
import { parseWatchPaths } from "./shared/watch-paths";

const CreateApplicationInputSchema = CreateResourceInputSchema.extend({
  type: z.literal("application"),
});

const UpdateApplicationInputSchema = UpdateResourceInputSchema.pick({
  id: true,
  name: true,
  appName: true,
  description: true,
  provider: true,
  dockerImage: true,
  buildRegistryId: true,
  rollbackActive: true,
  rollbackRegistryId: true,
  buildConfig: true,
  buildSecrets: true,
  buildEnvVars: true,
  isPreviewDeploymentsActive: true,
  previewLimit: true,
  previewWildcard: true,
  previewHttps: true,
  previewPort: true,
  advancedConfig: true,
  envVars: true,
  domains: true,
  serverId: true,
  buildServerId: true,
  triggerType: true,
  watchPaths: true,
  credentials: true,
  tagPattern: true,
}).extend({
  advancedConfig: ResourceAdvancedConfigSchema.optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  buildEnvVars: z.record(z.string(), z.string()).optional(),
  domains: z.array(DomainMappingSchema).optional(),
});

const authorizeApplication = createResourceAuthorizer({
  expectedType: "application",
  resourceLabel: "Application",
  missingProjectMessage: "Application project not found",
});

function publicApplication(resource: Resource) {
  let domains: ReturnType<typeof parseDomainMappings> = [];
  try {
    domains = parseDomainMappings(resource.domains);
  } catch {
    // The resource endpoint remains readable while an invalid legacy mapping is repaired.
  }

  return {
    id: resource.id,
    environmentId: resource.environmentId,
    name: resource.name,
    status: resource.status,
    provider: resource.provider,
    appName: resource.appName,
    description: resource.description,
    dockerImage: resource.dockerImage,
    buildRegistryId: resource.buildRegistryId ?? null,
    rollbackActive: resource.rollbackActive ?? false,
    rollbackRegistryId: resource.rollbackRegistryId ?? null,
    buildConfig: parseApplicationBuildConfig(resource.buildConfig),
    buildSecretsConfigured: Boolean(resource.buildSecrets),
    buildEnvVarsConfigured:
      Object.keys(parseResourceEnvironmentVariables(resource.buildEnvVars))
        .length > 0,
    advancedConfig: parseResourceAdvancedConfig(resource.advancedConfig),
    envVarsConfigured:
      Object.keys(parseResourceEnvironmentVariables(resource.envVars)).length >
      0,
    domains,
    isPreviewDeploymentsActive: resource.isPreviewDeploymentsActive,
    previewLimit: resource.previewLimit,
    previewWildcard: resource.previewWildcard,
    previewHttps: resource.previewHttps,
    previewPort: resource.previewPort,
    serverId: resource.serverId,
    buildServerId: resource.buildServerId,
    triggerType: resource.triggerType ?? "push",
    tagPattern: resource.tagPattern ?? null,
    watchPaths: parseWatchPaths(resource.watchPaths),
    webhookTokenPrefix: resource.webhookTokenPrefix,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  };
}

export const applicationRouter = router({
  create: twoFactorVerifiedProcedure
    .input(CreateApplicationInputSchema)
    .mutation(async ({ ctx, input }) => {
      const environment = await ctx.scope
        .resolve(GetEnvironmentUseCaseToken)
        .execute({
          id: input.environmentId,
        });
      const project = environment
        ? await ctx.scope
            .resolve(GetProjectUseCaseToken)
            .execute({ id: environment.projectId })
        : null;
      if (!project)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      await checkPermission(
        ctx.session.user.id,
        project.organizationId,
        "resource:create",
      );
      try {
        const resource = await ctx.scope
          .resolve(CreateResourceUseCaseToken)
          .execute(input);
        return publicApplication(resource);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  get: twoFactorVerifiedProcedure
    .input(GetResourceInputSchema)
    .query(async ({ ctx, input }) => {
      return publicApplication(
        await authorizeApplication(ctx, input.id, "resource:view"),
      );
    }),

  update: twoFactorVerifiedProcedure
    .input(UpdateApplicationInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeApplication(ctx, input.id, "resource:update");
      try {
        const {
          advancedConfig,
          envVars,
          buildEnvVars,
          domains,
          ...resourcePatch
        } = input;
        const resource = await ctx.scope
          .resolve(UpdateResourceUseCaseToken)
          .execute({
            ...resourcePatch,
            ...(advancedConfig
              ? { advancedConfig: JSON.stringify(advancedConfig) }
              : {}),
            ...(envVars ? { envVars: JSON.stringify(envVars) } : {}),
            ...(buildEnvVars
              ? { buildEnvVars: JSON.stringify(buildEnvVars) }
              : {}),
            ...(domains ? { domains: JSON.stringify(domains) } : {}),
          });
        if (!resource)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Application not found",
          });
        return publicApplication(resource);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  delete: twoFactorVerifiedProcedure
    .input(DeleteResourceInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeApplication(ctx, input.id, "resource:delete");
      try {
        return await ctx.scope
          .resolve(DeleteResourceUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
