import { TRPCError } from "@trpc/server";
import {
  DomainMappingSchema,
  parseDomainMappings,
  parseResourceAdvancedConfig,
  type Resource,
  ResourceAdvancedConfigSchema,
  ResourceComposeTypeSchema,
} from "@upstand/domain";
import {
  ControlResourceInputSchema,
  ConvertComposeInputSchema,
  DeleteResourceInputSchema,
  DeployResourceInputSchema,
  extractAndParametrizeEnvVars,
  InspectComposeInputSchema,
  parseResourceCredentials,
  parseResourceEnvironmentVariables,
  UpdateResourceInputSchema,
} from "@upstand/usecases";
import {
  ControlResourceUseCaseToken,
  CreateResourceUseCaseToken,
  DeleteResourceUseCaseToken,
  DeployResourceUseCaseToken,
  GetEnvironmentUseCaseToken,
  GetProjectUseCaseToken,
  InspectComposeUseCaseToken,
  RandomizeComposeUseCaseToken,
  UpdateResourceUseCaseToken,
} from "@upstand/usecases/tokens";
import { z } from "zod";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission } from "../permissions";
import { createResourceAuthorizer } from "./shared/resource-authorization";
import { parseWatchPaths } from "./shared/watch-paths";

const CreateComposeInputSchema = z.object({
  environmentId: z.string().min(1),
  name: z.string().min(1),
  appName: z.string().min(1),
  description: z.string().optional(),
  composeFile: z.string().min(1, "Compose file is required"),
  composeType: ResourceComposeTypeSchema.optional().default("stack"),
  advancedConfig: ResourceAdvancedConfigSchema.optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  domains: z.array(DomainMappingSchema).optional(),
  serverId: z.string().optional(),
  buildServerId: z.string().nullable().optional(),
});

const UpdateComposeInputSchema = UpdateResourceInputSchema.pick({
  id: true,
  name: true,
  appName: true,
  description: true,
  serverId: true,
  buildServerId: true,
  provider: true,
  credentials: true,
  triggerType: true,
  watchPaths: true,
  tagPattern: true,
}).extend({
  composeFile: z.string().min(1).optional(),
  composeType: ResourceComposeTypeSchema.optional(),
  advancedConfig: ResourceAdvancedConfigSchema.optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  domains: z.array(DomainMappingSchema).optional(),
});

const RandomizeComposeInputSchema = z.object({
  id: z.string().min(1),
});

const authorizeCompose = createResourceAuthorizer({
  expectedType: "compose",
  resourceLabel: "Compose resource",
  missingProjectMessage: "Environment not found",
});

function composePayload(resource: Resource) {
  let composeFile = "";
  try {
    const credentials = parseResourceCredentials(resource.credentials);
    if (typeof credentials.composeFile === "string") {
      composeFile = credentials.composeFile;
    }
  } catch {
    // Preserve a readable typed response for malformed legacy resources.
  }

  let domains: unknown[] = [];
  try {
    domains = parseDomainMappings(resource.domains);
  } catch {
    // Legacy domain data is handled by the generic resource repair path.
  }

  const envVars = parseResourceEnvironmentVariables(resource.envVars);

  return {
    id: resource.id,
    environmentId: resource.environmentId,
    name: resource.name,
    appName: resource.appName,
    description: resource.description,
    status: resource.status,
    composeType: resource.composeType,
    composeFileConfigured: composeFile.length > 0,
    advancedConfig: parseResourceAdvancedConfig(resource.advancedConfig),
    envVarsConfigured: Object.keys(envVars).length > 0,
    domains,
    serverId: resource.serverId,
    triggerType: resource.triggerType ?? "push",
    tagPattern: resource.tagPattern ?? null,
    watchPaths: parseWatchPaths(resource.watchPaths),
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  };
}

export const composeRouter = router({
  inspect: twoFactorVerifiedProcedure
    .input(
      z
        .object({ organizationId: z.string().min(1) })
        .merge(InspectComposeInputSchema),
    )
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "resource:create",
      );
      try {
        return await ctx.scope
          .resolve(InspectComposeUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  convert: twoFactorVerifiedProcedure
    .input(
      z
        .object({ organizationId: z.string().min(1) })
        .merge(ConvertComposeInputSchema),
    )
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "resource:create",
      );
      try {
        return await ctx.scope
          .resolve(InspectComposeUseCaseToken)
          .convert(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  create: twoFactorVerifiedProcedure
    .input(CreateComposeInputSchema)
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
          .execute({
            ...input,
            type: "compose",
            credentials: JSON.stringify({ composeFile: input.composeFile }),
          });
        return composePayload(resource);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  get: twoFactorVerifiedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) =>
      composePayload(await authorizeCompose(ctx, input.id, "resource:view")),
    ),

  update: twoFactorVerifiedProcedure
    .input(UpdateComposeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const resource = await authorizeCompose(ctx, input.id, "resource:update");
      const { composeFile, advancedConfig, envVars, domains, ...patch } = input;
      let credentials = input.credentials;
      let newEnvVars: Record<string, string> | undefined;

      if (composeFile !== undefined) {
        let current: Record<string, unknown> = {};
        try {
          current = parseResourceCredentials(resource.credentials);
        } catch {
          current = {};
        }

        const extracted = extractAndParametrizeEnvVars(composeFile);
        const resolvedComposeFile = extracted.composeFile;

        const existingEnvVars = parseResourceEnvironmentVariables(
          resource.envVars,
        );
        newEnvVars = { ...extracted.envVars, ...existingEnvVars };

        let parsedInputCreds: Record<string, unknown> = {};
        if (input.credentials) {
          try {
            parsedInputCreds = JSON.parse(input.credentials);
          } catch {}
        }
        credentials = JSON.stringify({
          ...current,
          ...parsedInputCreds,
          composeFile: resolvedComposeFile,
        });
      }

      let finalEnvVars = envVars;
      if (newEnvVars) {
        finalEnvVars = { ...newEnvVars, ...envVars };
      }

      try {
        const updated = await ctx.scope
          .resolve(UpdateResourceUseCaseToken)
          .execute({
            ...patch,
            ...(credentials ? { credentials } : {}),
            ...(advancedConfig
              ? { advancedConfig: JSON.stringify(advancedConfig) }
              : {}),
            ...(finalEnvVars ? { envVars: JSON.stringify(finalEnvVars) } : {}),
            ...(domains ? { domains: JSON.stringify(domains) } : {}),
          });
        if (!updated)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Compose resource not found",
          });
        return composePayload(updated);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  deploy: twoFactorVerifiedProcedure
    .input(DeployResourceInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeCompose(ctx, input.id, "resource:update");
      try {
        return composePayload(
          await ctx.scope.resolve(DeployResourceUseCaseToken).execute(input),
        );
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  control: twoFactorVerifiedProcedure
    .input(ControlResourceInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeCompose(ctx, input.id, "resource:update");
      try {
        return composePayload(
          await ctx.scope.resolve(ControlResourceUseCaseToken).execute(input),
        );
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  delete: twoFactorVerifiedProcedure
    .input(DeleteResourceInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeCompose(ctx, input.id, "resource:delete");
      try {
        return await ctx.scope
          .resolve(DeleteResourceUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  randomize: twoFactorVerifiedProcedure
    .input(RandomizeComposeInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeCompose(ctx, input.id, "resource:update");
      try {
        return composePayload(
          await ctx.scope.resolve(RandomizeComposeUseCaseToken).execute(input),
        );
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
