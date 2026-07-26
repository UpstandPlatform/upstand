import { TRPCError } from "@trpc/server";
import {
  CreateScheduleInputSchema,
  DeleteScheduleInputSchema,
  GetCronJobObservabilityInputSchema,
  GetScheduleLogsInputSchema,
  GetSchedulesInputSchema,
  UpdateScheduleInputSchema,
} from "@upstand/domain";
import {
  CreateScheduleUseCaseToken,
  DeleteScheduleUseCaseToken,
  GeneralSchedulerToken,
  GetScheduleLogsUseCaseToken,
  GetSchedulesUseCaseToken,
  UnitOfWorkToken,
  UpdateScheduleUseCaseToken,
} from "@upstand/usecases/tokens";
import type { AuthenticatedContext } from "../context";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission, type PermissionAction } from "../permissions";
import { authorizeResource as authorizeResourceScope } from "./shared/resource-authorization";

async function authorizeResource(
  ctx: AuthenticatedContext,
  resourceId: string,
  action: PermissionAction,
) {
  return authorizeResourceScope(ctx, resourceId, {
    action,
    missingProjectMessage: "Project not found",
  });
}

export const scheduleRouter = router({
  list: twoFactorVerifiedProcedure
    .input(GetSchedulesInputSchema)
    .query(async ({ ctx, input }) => {
      await authorizeResource(ctx, input.resourceId, "resource:view");
      return ctx.scope.resolve(GetSchedulesUseCaseToken).execute(input);
    }),
  listObservability: twoFactorVerifiedProcedure
    .input(GetCronJobObservabilityInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "resource:view",
      );
      return ctx.scope
        .resolve(UnitOfWorkToken)
        .scheduleLogRepository.getObservabilityMetrics(input);
    }),
  listLogs: twoFactorVerifiedProcedure
    .input(GetScheduleLogsInputSchema)
    .query(async ({ ctx, input }) => {
      if (!input.resourceId && !input.scheduleId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Either resourceId or scheduleId must be provided",
        });
      }
      if (input.resourceId) {
        await authorizeResource(ctx, input.resourceId, "resource:view");
      } else if (input.scheduleId) {
        const schedule = await ctx.scope
          .resolve(UnitOfWorkToken)
          .scheduleRepository.findById(input.scheduleId);
        if (!schedule) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Schedule not found",
          });
        }
        if (schedule.resourceId) {
          await authorizeResource(ctx, schedule.resourceId, "resource:view");
        }
      }
      return ctx.scope.resolve(GetScheduleLogsUseCaseToken).execute(input);
    }),
  create: twoFactorVerifiedProcedure
    .input(CreateScheduleInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeResource(ctx, input.resourceId, "resource:update");
      try {
        const result = await ctx.scope
          .resolve(CreateScheduleUseCaseToken)
          .execute(input);
        await ctx.scope.resolve(GeneralSchedulerToken).refresh();
        return result;
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
  update: twoFactorVerifiedProcedure
    .input(UpdateScheduleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const schedule = await ctx.scope
        .resolve(UnitOfWorkToken)
        .scheduleRepository.findById(input.id);
      if (!schedule) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Schedule not found",
        });
      }
      await authorizeResource(
        ctx,
        schedule.resourceId || "",
        "resource:update",
      );
      try {
        const result = await ctx.scope
          .resolve(UpdateScheduleUseCaseToken)
          .execute(input);
        await ctx.scope.resolve(GeneralSchedulerToken).refresh();
        return result;
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
  runNow: twoFactorVerifiedProcedure
    .input(DeleteScheduleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const schedule = await ctx.scope
        .resolve(UnitOfWorkToken)
        .scheduleRepository.findById(input.id);
      if (!schedule) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Schedule not found",
        });
      }
      await authorizeResource(
        ctx,
        schedule.resourceId || "",
        "resource:update",
      );
      await ctx.scope.resolve(GeneralSchedulerToken).executeNow(input.id);
      return { accepted: true };
    }),
  delete: twoFactorVerifiedProcedure
    .input(DeleteScheduleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const schedule = await ctx.scope
        .resolve(UnitOfWorkToken)
        .scheduleRepository.findById(input.id);
      if (!schedule) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Schedule not found",
        });
      }
      await authorizeResource(
        ctx,
        schedule.resourceId || "",
        "resource:update",
      );
      const deleted = await ctx.scope
        .resolve(DeleteScheduleUseCaseToken)
        .execute(input);
      await ctx.scope.resolve(GeneralSchedulerToken).refresh();
      return { deleted };
    }),
});
