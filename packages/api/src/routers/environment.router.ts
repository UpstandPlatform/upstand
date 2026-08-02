import { TRPCError } from "@trpc/server";
import type {
  Environment,
  EnvironmentSummaryProjection,
} from "@upstand/domain";
import {
  CloneEnvironmentInputSchema,
  CreateEnvironmentInputSchema,
  DeleteEnvironmentInputSchema,
  DiffEnvironmentsInputSchema,
  GetEnvironmentInputSchema,
  GetEnvironmentsInputSchema,
  PromoteEnvironmentInputSchema,
  parseResourceEnvironmentVariables,
  UpdateEnvironmentInputSchema,
} from "@upstand/usecases";
import {
  CloneEnvironmentUseCaseToken,
  CreateEnvironmentUseCaseToken,
  DeleteEnvironmentUseCaseToken,
  DiffEnvironmentsUseCaseToken,
  GetEnvironmentsUseCaseToken,
  GetEnvironmentUseCaseToken,
  GetProjectUseCaseToken,
  PromoteEnvironmentUseCaseToken,
  UpdateEnvironmentUseCaseToken,
} from "@upstand/usecases/tokens";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission } from "../permissions";
import { resolveEnvironmentAndCheckPermission } from "../trpc/environment-authorization.helper";

export function publicEnvironment(
  env: Environment | EnvironmentSummaryProjection,
) {
  if ("envVarsConfigured" in env) {
    const { envVarsConfigured, ...rest } = env;
    return {
      ...rest,
      envVars: {},
      envVarsConfigured,
    };
  }

  const { envVars, ...rest } = env;
  return {
    ...rest,
    envVars: {},
    envVarsConfigured: Boolean(envVars),
  };
}

export const environmentRouter = router({
  create: twoFactorVerifiedProcedure
    .input(CreateEnvironmentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const projectUseCase = ctx.scope.resolve(GetProjectUseCaseToken);
      const project = await projectUseCase.execute({ id: input.projectId });
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      await checkPermission(
        ctx.session.user.id,
        project.organizationId,
        "environment:create",
      );

      const useCase = ctx.scope.resolve(CreateEnvironmentUseCaseToken);
      try {
        const result = await useCase.execute(input);
        return publicEnvironment(result);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  list: twoFactorVerifiedProcedure
    .input(GetEnvironmentsInputSchema)
    .query(async ({ ctx, input }) => {
      const projectUseCase = ctx.scope.resolve(GetProjectUseCaseToken);
      const project = await projectUseCase.execute({ id: input.projectId });
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      await checkPermission(
        ctx.session.user.id,
        project.organizationId,
        "environment:view",
      );

      const useCase = ctx.scope.resolve(GetEnvironmentsUseCaseToken);
      try {
        const result = await useCase.execute(input);
        return result.map(publicEnvironment);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  get: twoFactorVerifiedProcedure
    .input(GetEnvironmentInputSchema)
    .query(async ({ ctx, input }) => {
      const { environment } = await resolveEnvironmentAndCheckPermission(
        ctx,
        input.id,
        "environment:view",
      );
      return publicEnvironment(environment);
    }),

  getSecrets: twoFactorVerifiedProcedure
    .input(GetEnvironmentInputSchema)
    .query(async ({ ctx, input }) => {
      const useCase = ctx.scope.resolve(GetEnvironmentUseCaseToken);
      const summary = await useCase.executeSummary(input);
      if (!summary) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      const project = await ctx.scope
        .resolve(GetProjectUseCaseToken)
        .execute({ id: summary.projectId });
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment project not found",
        });
      }

      await checkPermission(
        ctx.session.user.id,
        project.organizationId,
        "environment:secrets:view",
      );

      const environment = await useCase.execute(input);
      if (!environment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      return {
        envVars: parseResourceEnvironmentVariables(environment.envVars),
      };
    }),

  update: twoFactorVerifiedProcedure
    .input(UpdateEnvironmentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { project } = await resolveEnvironmentAndCheckPermission(
        ctx,
        input.id,
        "environment:update",
      );
      const updateUseCase = ctx.scope.resolve(UpdateEnvironmentUseCaseToken);
      try {
        const result = await updateUseCase.execute({
          ...input,
          organizationId: project.organizationId,
        });
        return publicEnvironment(result);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  delete: twoFactorVerifiedProcedure
    .input(DeleteEnvironmentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { project } = await resolveEnvironmentAndCheckPermission(
        ctx,
        input.id,
        "environment:delete",
      );

      const deleteUseCase = ctx.scope.resolve(DeleteEnvironmentUseCaseToken);
      try {
        return await deleteUseCase.execute({
          ...input,
          organizationId: project.organizationId,
        });
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  clone: twoFactorVerifiedProcedure
    .input(CloneEnvironmentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.scope
        .resolve(GetEnvironmentUseCaseToken)
        .execute({ id: input.sourceEnvironmentId });
      if (!source)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      const project = await ctx.scope
        .resolve(GetProjectUseCaseToken)
        .execute({ id: source.projectId });
      if (!project)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      await checkPermission(
        ctx.session.user.id,
        project.organizationId,
        "environment:create",
      );
      try {
        return publicEnvironment(
          await ctx.scope.resolve(CloneEnvironmentUseCaseToken).execute(input),
        );
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  diff: twoFactorVerifiedProcedure
    .input(DiffEnvironmentsInputSchema)
    .query(async ({ ctx, input }) => {
      const source = await ctx.scope
        .resolve(GetEnvironmentUseCaseToken)
        .execute({ id: input.sourceEnvironmentId });
      const target = await ctx.scope
        .resolve(GetEnvironmentUseCaseToken)
        .execute({ id: input.targetEnvironmentId });
      if (!source || !target)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      const project = await ctx.scope
        .resolve(GetProjectUseCaseToken)
        .execute({ id: source.projectId });
      if (!project || project.id !== target.projectId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Environments must belong to the same project",
        });
      await checkPermission(
        ctx.session.user.id,
        project.organizationId,
        "environment:view",
      );
      try {
        return await ctx.scope
          .resolve(DiffEnvironmentsUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  promote: twoFactorVerifiedProcedure
    .input(PromoteEnvironmentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.scope
        .resolve(GetEnvironmentUseCaseToken)
        .execute({ id: input.sourceEnvironmentId });
      const target = await ctx.scope
        .resolve(GetEnvironmentUseCaseToken)
        .execute({ id: input.targetEnvironmentId });
      if (!source || !target)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      const project = await ctx.scope
        .resolve(GetProjectUseCaseToken)
        .execute({ id: source.projectId });
      if (!project || project.id !== target.projectId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Environments must belong to the same project",
        });
      await checkPermission(
        ctx.session.user.id,
        project.organizationId,
        "environment:update",
      );
      try {
        return await ctx.scope
          .resolve(PromoteEnvironmentUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
