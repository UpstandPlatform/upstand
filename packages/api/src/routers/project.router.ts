import { TRPCError } from "@trpc/server";
import {
  CreateProjectInputSchema,
  DeleteProjectInputSchema,
  DuplicateProjectInputSchema,
  GetProjectInputSchema,
  GetProjectsInputSchema,
  UpdateProjectInputSchema,
} from "@upstand/usecases";
import {
  CreateProjectUseCaseToken,
  DeleteProjectUseCaseToken,
  DuplicateProjectUseCaseToken,
  GetProjectsUseCaseToken,
  GetProjectUseCaseToken,
  UpdateProjectUseCaseToken,
} from "@upstand/usecases/tokens";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission } from "../permissions";

export const projectRouter = router({
  create: twoFactorVerifiedProcedure
    .input(CreateProjectInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "project:create",
      );

      const useCase = ctx.scope.resolve(CreateProjectUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  list: twoFactorVerifiedProcedure
    .input(GetProjectsInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "project:view",
      );

      const useCase = ctx.scope.resolve(GetProjectsUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  get: twoFactorVerifiedProcedure
    .input(GetProjectInputSchema)
    .query(async ({ ctx, input }) => {
      const useCase = ctx.scope.resolve(GetProjectUseCaseToken);
      try {
        const project = await useCase.execute(input);
        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }

        await checkPermission(
          ctx.session.user.id,
          project.organizationId,
          "project:view",
        );

        return project;
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  update: twoFactorVerifiedProcedure
    .input(UpdateProjectInputSchema)
    .mutation(async ({ ctx, input }) => {
      const getProjectUseCase = ctx.scope.resolve(GetProjectUseCaseToken);
      const existing = await getProjectUseCase.execute({ id: input.id });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      await checkPermission(
        ctx.session.user.id,
        existing.organizationId,
        "project:update",
      );

      const useCase = ctx.scope.resolve(UpdateProjectUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  deleteProject: twoFactorVerifiedProcedure
    .input(DeleteProjectInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "project:delete",
      );

      const useCase = ctx.scope.resolve(DeleteProjectUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  duplicate: twoFactorVerifiedProcedure
    .input(DuplicateProjectInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "project:create",
      );
      const useCase = ctx.scope.resolve(DuplicateProjectUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
