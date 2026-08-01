import { TRPCError } from "@trpc/server";
import {
  CreateSecretProviderInputSchema,
  CreateSecretRotationScheduleInputSchema,
  ListSecretVersionsInputSchema,
  RestoreSecretVersionInputSchema,
  RotateSecretsInputSchema,
  SyncSecretProviderInputSchema,
  TestSecretProviderConnectionInputSchema,
  UpdateSecretProviderInputSchema,
  UpdateSecretRotationScheduleInputSchema,
} from "@upstand/usecases";
import {
  CreateSecretProviderUseCaseToken,
  CreateSecretRotationScheduleUseCaseToken,
  DeleteSecretProviderUseCaseToken,
  DeleteSecretRotationScheduleUseCaseToken,
  GetSecretVersionUseCaseToken,
  ListSecretProvidersUseCaseToken,
  ListSecretRotationSchedulesUseCaseToken,
  ListSecretVersionsUseCaseToken,
  RestoreSecretVersionUseCaseToken,
  RotateSecretsUseCaseToken,
  SyncSecretProviderUseCaseToken,
  TestSecretProviderConnectionUseCaseToken,
  UnitOfWorkToken,
  UpdateSecretProviderUseCaseToken,
  UpdateSecretRotationScheduleUseCaseToken,
} from "@upstand/usecases/tokens";
import { z } from "zod";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission } from "../permissions";
import { resolveSecretScopeAndCheckPermission } from "../trpc/secret-authorization.helper";

export const secretRouter = router({
  versions: twoFactorVerifiedProcedure
    .input(ListSecretVersionsInputSchema)
    .query(async ({ ctx, input }) => {
      const organizationId = await resolveSecretScopeAndCheckPermission(
        ctx,
        input.scopeType,
        input.scopeId,
        "resource:secrets:view",
      );
      return ctx.scope
        .resolve(ListSecretVersionsUseCaseToken)
        .execute({ ...input, organizationId });
    }),
  version: twoFactorVerifiedProcedure
    .input(RestoreSecretVersionInputSchema)
    .query(async ({ ctx, input }) => {
      const organizationId = await resolveSecretScopeAndCheckPermission(
        ctx,
        input.scopeType,
        input.scopeId,
        "resource:secrets:view",
      );
      return ctx.scope
        .resolve(GetSecretVersionUseCaseToken)
        .execute({ ...input, organizationId });
    }),
  restore: twoFactorVerifiedProcedure
    .input(RestoreSecretVersionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const organizationId = await resolveSecretScopeAndCheckPermission(
        ctx,
        input.scopeType,
        input.scopeId,
        "resource:update",
      );
      await ctx.scope
        .resolve(RestoreSecretVersionUseCaseToken)
        .execute({ ...input, organizationId });
      return { success: true };
    }),
  providers: twoFactorVerifiedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const organizationId = input.organizationId;
      await checkPermission(
        ctx.session.user.id,
        organizationId,
        "resource:view",
      );
      return ctx.scope
        .resolve(ListSecretProvidersUseCaseToken)
        .execute(organizationId);
    }),
  createProvider: twoFactorVerifiedProcedure
    .input(CreateSecretProviderInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "environment:update",
      );
      return ctx.scope.resolve(CreateSecretProviderUseCaseToken).execute(input);
    }),
  deleteProvider: twoFactorVerifiedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const provider = await ctx.scope
        .resolve(UnitOfWorkToken)
        .secretProviderRepository.findById(input.id);
      if (!provider)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Secret provider not found",
        });
      await checkPermission(
        ctx.session.user.id,
        provider.organizationId,
        "environment:update",
      );
      await ctx.scope
        .resolve(DeleteSecretProviderUseCaseToken)
        .execute(input.id);
      return { success: true };
    }),
  updateProvider: twoFactorVerifiedProcedure
    .input(UpdateSecretProviderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const provider = await ctx.scope
        .resolve(UnitOfWorkToken)
        .secretProviderRepository.findById(input.id);
      if (!provider)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Secret provider not found",
        });
      await checkPermission(
        ctx.session.user.id,
        provider.organizationId,
        "environment:update",
      );
      return ctx.scope.resolve(UpdateSecretProviderUseCaseToken).execute(input);
    }),
  testConnection: twoFactorVerifiedProcedure
    .input(TestSecretProviderConnectionInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "environment:update",
      );
      return ctx.scope
        .resolve(TestSecretProviderConnectionUseCaseToken)
        .execute(input);
    }),
  sync: twoFactorVerifiedProcedure
    .input(SyncSecretProviderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const organizationId = await resolveSecretScopeAndCheckPermission(
        ctx,
        input.scopeType,
        input.scopeId,
        "resource:update",
      );
      return ctx.scope
        .resolve(SyncSecretProviderUseCaseToken)
        .execute({ ...input, organizationId });
    }),
  rotate: twoFactorVerifiedProcedure
    .input(RotateSecretsInputSchema)
    .mutation(async ({ ctx, input }) => {
      await resolveSecretScopeAndCheckPermission(
        ctx,
        input.scopeType,
        input.scopeId,
        "resource:update",
      );
      return ctx.scope.resolve(RotateSecretsUseCaseToken).execute(input);
    }),
  rotationSchedules: twoFactorVerifiedProcedure
    .input(ListSecretVersionsInputSchema)
    .query(async ({ ctx, input }) => {
      await resolveSecretScopeAndCheckPermission(
        ctx,
        input.scopeType,
        input.scopeId,
        "resource:view",
      );
      return ctx.scope
        .resolve(ListSecretRotationSchedulesUseCaseToken)
        .execute(input.scopeType, input.scopeId);
    }),
  createRotationSchedule: twoFactorVerifiedProcedure
    .input(CreateSecretRotationScheduleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const organizationId = await resolveSecretScopeAndCheckPermission(
        ctx,
        input.scopeType,
        input.scopeId,
        "resource:update",
      );
      if (organizationId !== input.organizationId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Secret scope belongs to another organization",
        });
      return ctx.scope
        .resolve(CreateSecretRotationScheduleUseCaseToken)
        .execute(input);
    }),
  updateRotationSchedule: twoFactorVerifiedProcedure
    .input(UpdateSecretRotationScheduleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const schedule = await ctx.scope
        .resolve(UnitOfWorkToken)
        .secretRotationScheduleRepository?.findById(input.id);
      if (!schedule)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Secret rotation schedule not found",
        });
      await checkPermission(
        ctx.session.user.id,
        schedule.organizationId,
        "resource:update",
      );
      return ctx.scope
        .resolve(UpdateSecretRotationScheduleUseCaseToken)
        .execute(input);
    }),
  deleteRotationSchedule: twoFactorVerifiedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const schedule = await ctx.scope
        .resolve(UnitOfWorkToken)
        .secretRotationScheduleRepository?.findById(input.id);
      if (!schedule)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Secret rotation schedule not found",
        });
      await checkPermission(
        ctx.session.user.id,
        schedule.organizationId,
        "resource:update",
      );
      return ctx.scope
        .resolve(DeleteSecretRotationScheduleUseCaseToken)
        .execute(input.id);
    }),
});
