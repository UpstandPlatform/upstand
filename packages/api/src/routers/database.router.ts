import { TRPCError } from "@trpc/server";
import { parseResourceAdvancedConfig, type Resource } from "@upstand/domain";
import {
  ControlResourceInputSchema,
  CreateResourceInputSchema,
  DatabaseCommandInputSchema,
  DeleteResourceInputSchema,
  GetResourceInputSchema,
  RebuildDatabaseInputSchema,
  RunDatabaseMigrationInputSchema,
  UpdateResourceInputSchema,
} from "@upstand/usecases";
import {
  ControlResourceUseCaseToken,
  CreateResourceUseCaseToken,
  DatabaseCommandUseCaseToken,
  DeleteResourceUseCaseToken,
  GetEnvironmentUseCaseToken,
  GetProjectUseCaseToken,
  RebuildDatabaseUseCaseToken,
  RunDatabaseMigrationUseCaseToken,
  UpdateResourceUseCaseToken,
} from "@upstand/usecases/tokens";
import { z } from "zod";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission } from "../permissions";
import { createResourceAuthorizer } from "./shared/resource-authorization";

const DatabaseTypeSchema = z.enum([
  "postgres",
  "mysql",
  "mariadb",
  "mongodb",
  "redis",
  "libsql",
]);

const CreateDatabaseInputSchema = CreateResourceInputSchema.extend({
  type: z.literal("database"),
  dbType: DatabaseTypeSchema,
});

const UpdateDatabaseInputSchema = UpdateResourceInputSchema.pick({
  id: true,
  name: true,
  description: true,
  dbType: true,
  dockerImage: true,
  allowCustomImage: true,
  externalPort: true,
  libsqlGrpcPort: true,
  libsqlAdminPort: true,
  credentials: true,
  serverId: true,
});

const authorizeDatabase = createResourceAuthorizer({
  expectedType: "database",
  resourceLabel: "Database",
  missingProjectMessage: "Database project not found",
});

function publicDatabase(resource: Resource) {
  return {
    id: resource.id,
    environmentId: resource.environmentId,
    name: resource.name,
    status: resource.status,
    dbType: resource.dbType,
    dockerImage: resource.dockerImage,
    externalPort: resource.externalPort,
    libsqlGrpcPort: resource.libsqlGrpcPort,
    libsqlAdminPort: resource.libsqlAdminPort,
    credentialsConfigured: Boolean(resource.credentials),
    advancedConfig: parseResourceAdvancedConfig(resource.advancedConfig),
    serverId: resource.serverId,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  };
}

export const databaseRouter = router({
  create: twoFactorVerifiedProcedure
    .input(CreateDatabaseInputSchema)
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
        return publicDatabase(
          await ctx.scope.resolve(CreateResourceUseCaseToken).execute(input),
        );
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  get: twoFactorVerifiedProcedure
    .input(GetResourceInputSchema)
    .query(async ({ ctx, input }) =>
      publicDatabase(await authorizeDatabase(ctx, input.id, "resource:view")),
    ),

  update: twoFactorVerifiedProcedure
    .input(UpdateDatabaseInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeDatabase(ctx, input.id, "resource:update");
      try {
        const resource = await ctx.scope
          .resolve(UpdateResourceUseCaseToken)
          .execute(input);
        if (!resource)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Database not found",
          });
        return publicDatabase(resource);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  control: twoFactorVerifiedProcedure
    .input(ControlResourceInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeDatabase(ctx, input.id, "resource:update");
      try {
        return publicDatabase(
          await ctx.scope.resolve(ControlResourceUseCaseToken).execute(input),
        );
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  rebuild: twoFactorVerifiedProcedure
    .input(RebuildDatabaseInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeDatabase(ctx, input.id, "resource:update");
      try {
        return publicDatabase(
          await ctx.scope.resolve(RebuildDatabaseUseCaseToken).execute(input),
        );
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  command: twoFactorVerifiedProcedure
    .input(DatabaseCommandInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeDatabase(ctx, input.id, "resource:update");
      try {
        return await ctx.scope
          .resolve(DatabaseCommandUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  delete: twoFactorVerifiedProcedure
    .input(DeleteResourceInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeDatabase(ctx, input.id, "resource:delete");
      try {
        return await ctx.scope
          .resolve(DeleteResourceUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  runMigration: twoFactorVerifiedProcedure
    .input(RunDatabaseMigrationInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeDatabase(ctx, input.resourceId, "resource:update");
      try {
        return await ctx.scope
          .resolve(RunDatabaseMigrationUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
