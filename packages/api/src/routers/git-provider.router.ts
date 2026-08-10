import { TRPCError } from "@trpc/server";
import { GitHubDiagnosticsHttpClient } from "@upstand/infrastructure";
import { redis, withRedisTimeout } from "@upstand/redis";
import {
  CreateGitProviderInputSchema,
  createGitProviderOAuthState,
  DeleteGitProviderInputSchema,
  GetGitProvidersInputSchema,
  GIT_PROVIDER_OAUTH_STATE_TTL_SECONDS,
  gitProviderOAuthStateKey,
  ListGitBranchesInputSchema,
  ListGitRepositoriesInputSchema,
  RunGitHubDiagnosticsInputSchema,
  RunGitHubDiagnosticsUseCase,
  redactGitProvider,
  UpdateGitProviderInputSchema,
} from "@upstand/usecases";
import {
  CreateGitProviderUseCaseToken,
  DeleteGitProviderUseCaseToken,
  GetGitProvidersUseCaseToken,
  ListGitBranchesUseCaseToken,
  ListGitRepositoriesUseCaseToken,
  UnitOfWorkToken,
  UpdateGitProviderUseCaseToken,
} from "@upstand/usecases/tokens";
import { z } from "zod";
import { handleUseCaseError } from "../errors";
import {
  protectedProcedure,
  router,
  twoFactorVerifiedProcedure,
} from "../index";
import { checkPermission } from "../permissions";

export const gitProviderRouter = router({
  diagnostics: protectedProcedure
    .input(RunGitHubDiagnosticsInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "git_provider:view",
      );
      try {
        return await new RunGitHubDiagnosticsUseCase(
          ctx.scope.resolve(UnitOfWorkToken),
          new GitHubDiagnosticsHttpClient(),
          async () => {
            try {
              return (await withRedisTimeout(redis.ping(), 1_000)) === "PONG";
            } catch {
              return false;
            }
          },
        ).execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  createOAuthState: twoFactorVerifiedProcedure
    .input(
      GetGitProvidersInputSchema.pick({ organizationId: true }).extend({
        providerId: GetGitProvidersInputSchema.shape.organizationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const provider = await uow.gitProviderRepository.findById(
        input.providerId,
      );
      if (!provider || provider.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Git Provider not found",
        });
      }
      if (
        provider.provider !== "github" &&
        provider.provider !== "gitlab" &&
        provider.provider !== "gitea"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This Git provider does not use an OAuth authorization flow",
        });
      }
      await checkPermission(
        ctx.session.user.id,
        provider.organizationId,
        "git_provider:view",
      );

      const state = createGitProviderOAuthState(
        provider.id,
        provider.provider === "github" ? "github-install" : "provider-oauth",
        {
          organizationId: provider.organizationId,
          userId: ctx.session.user.id,
        },
      );
      await withRedisTimeout(
        redis.set(
          gitProviderOAuthStateKey(state.state),
          provider.id,
          "EX",
          GIT_PROVIDER_OAUTH_STATE_TTL_SECONDS,
          "NX",
        ),
      );
      return state;
    }),

  createGithubManifestState: twoFactorVerifiedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "git_provider:create",
      );
      const subject = `github-init:${input.organizationId}:${ctx.session.user.id}`;
      const state = createGitProviderOAuthState(subject, "github-init", {
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
      });
      await withRedisTimeout(
        redis.set(
          gitProviderOAuthStateKey(state.state),
          subject,
          "EX",
          GIT_PROVIDER_OAUTH_STATE_TTL_SECONDS,
          "NX",
        ),
      );
      return state;
    }),

  create: twoFactorVerifiedProcedure
    .input(CreateGitProviderInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "git_provider:create",
      );

      const useCase = ctx.scope.resolve(CreateGitProviderUseCaseToken);
      try {
        const provider = await useCase.execute(input);
        return redactGitProvider(provider);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  list: twoFactorVerifiedProcedure
    .input(GetGitProvidersInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "git_provider:view",
      );

      const useCase = ctx.scope.resolve(GetGitProvidersUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  update: twoFactorVerifiedProcedure
    .input(UpdateGitProviderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const provider = await uow.gitProviderRepository.findById(input.id);
      if (!provider) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Git Provider not found",
        });
      }
      await checkPermission(
        ctx.session.user.id,
        provider.organizationId,
        "git_provider:update",
      );
      const useCase = ctx.scope.resolve(UpdateGitProviderUseCaseToken);
      try {
        const updated = await useCase.execute({
          ...input,
          organizationId: provider.organizationId,
        });
        if (!updated) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Git Provider not found",
          });
        }
        return redactGitProvider(updated);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  delete: twoFactorVerifiedProcedure
    .input(DeleteGitProviderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const provider = await uow.gitProviderRepository.findById(input.id);
      if (!provider) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Git Provider not found",
        });
      }

      await checkPermission(
        ctx.session.user.id,
        provider.organizationId,
        "git_provider:delete",
      );

      const deleteUseCase = ctx.scope.resolve(DeleteGitProviderUseCaseToken);
      try {
        return await deleteUseCase.execute({
          ...input,
          organizationId: provider.organizationId,
        });
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  listRepositories: twoFactorVerifiedProcedure
    .input(ListGitRepositoriesInputSchema)
    .query(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const provider = await uow.gitProviderRepository.findById(
        input.gitProviderId,
      );
      if (!provider) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Git Provider not found",
        });
      }

      await checkPermission(
        ctx.session.user.id,
        provider.organizationId,
        "git_provider:view",
      );

      const useCase = ctx.scope.resolve(ListGitRepositoriesUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  listBranches: twoFactorVerifiedProcedure
    .input(ListGitBranchesInputSchema)
    .query(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const provider = await uow.gitProviderRepository.findById(
        input.gitProviderId,
      );
      if (!provider) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Git Provider not found",
        });
      }

      await checkPermission(
        ctx.session.user.id,
        provider.organizationId,
        "git_provider:view",
      );

      const useCase = ctx.scope.resolve(ListGitBranchesUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
