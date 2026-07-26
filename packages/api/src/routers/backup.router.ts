import { TRPCError } from "@trpc/server";
import {
  CreateBackupScheduleInputSchema,
  CreateWebServerBackupScheduleInputSchema,
  DeleteBackupScheduleInputSchema,
  GetBackupRunsInputSchema,
  GetBackupSchedulesInputSchema,
  ListBackupVolumesInputSchema,
  ListComposeServicesInputSchema,
  RestoreBackupRunInputSchema,
  TriggerBackupRunInputSchema,
  UpdateBackupScheduleInputSchema,
} from "@upstand/usecases";
import {
  BackupSchedulerToken,
  CreateBackupScheduleUseCaseToken,
  CreateWebServerBackupScheduleUseCaseToken,
  DeleteBackupScheduleUseCaseToken,
  GetBackupRunsUseCaseToken,
  GetBackupSchedulesUseCaseToken,
  ListBackupVolumesUseCaseToken,
  ListComposeServicesUseCaseToken,
  RestoreBackupRunUseCaseToken,
  TriggerBackupRunUseCaseToken,
  UnitOfWorkToken,
  UpdateBackupScheduleUseCaseToken,
  UpdateWebServerBackupScheduleUseCaseToken,
  VerifyBackupRunUseCaseToken,
} from "@upstand/usecases/tokens";
import { z } from "zod";
import type { AuthenticatedContext } from "../context";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { requireInstanceOwnerContext } from "../instance-access";
import {
  authorizeContextCapability,
  type PermissionAction,
} from "../permissions";
import { authorizeResource } from "./shared/resource-authorization";

async function assertResourcePermission(
  ctx: AuthenticatedContext,
  resourceId: string,
  permission: PermissionAction,
) {
  return authorizeResource(ctx, resourceId, { action: permission });
}

async function resolveResourceBackupScheduleAndCheckPermission(
  ctx: AuthenticatedContext,
  scheduleId: string,
  permission: PermissionAction,
) {
  const uow = ctx.scope.resolve(UnitOfWorkToken);
  const schedule = await uow.backupScheduleRepository.findById(scheduleId);
  if (!schedule) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Backup schedule not found",
    });
  }
  if (schedule.kind === "web-server") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Use the web-server backup schedule endpoint",
    });
  }
  if (!schedule.resourceId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Backup schedule has no resource",
    });
  }
  await assertResourcePermission(ctx, schedule.resourceId, permission);
  return schedule;
}

async function assertOrganizationPermission(
  ctx: AuthenticatedContext,
  _organizationId: string,
  permission: PermissionAction,
): Promise<void> {
  await requireInstanceOwnerContext(ctx);
  await authorizeContextCapability(ctx, _organizationId, permission);
}

async function assertWebServerSchedulePermission(
  ctx: AuthenticatedContext,
  scheduleId: string,
  permission: PermissionAction,
) {
  const uow = ctx.scope.resolve(UnitOfWorkToken);
  const schedule = await uow.backupScheduleRepository.findById(scheduleId);
  if (schedule?.kind !== "web-server") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Web-server backup schedule not found",
    });
  }
  await assertOrganizationPermission(ctx, schedule.organizationId, permission);
  return schedule;
}

export const backupRouter = router({
  listWebServerSchedules: twoFactorVerifiedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertOrganizationPermission(
        ctx,
        input.organizationId,
        "backup:view",
      );
      const schedules = await ctx.scope
        .resolve(UnitOfWorkToken)
        .backupScheduleRepository.findByOrganizationId(input.organizationId);
      return schedules
        .filter((schedule) => schedule.kind === "web-server")
        .map(
          ({ encryptedConfiguration: _encryptedConfiguration, ...schedule }) =>
            schedule,
        );
    }),

  listWebServerRuns: twoFactorVerifiedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertOrganizationPermission(
        ctx,
        input.organizationId,
        "backup:view",
      );
      const runs = await ctx.scope
        .resolve(UnitOfWorkToken)
        .backupRunRepository.findByOrganizationId(
          input.organizationId,
          input.limit,
        );
      return runs.filter((run) => run.kind === "web-server");
    }),

  createWebServerSchedule: twoFactorVerifiedProcedure
    .input(CreateWebServerBackupScheduleInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertOrganizationPermission(
        ctx,
        input.organizationId,
        "backup:manage",
      );
      try {
        const result = await ctx.scope
          .resolve(CreateWebServerBackupScheduleUseCaseToken)
          .execute(input);
        await ctx.scope.resolve(BackupSchedulerToken).refresh();
        return result;
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  updateWebServerSchedule: twoFactorVerifiedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        organizationId: z.string().min(1),
        destinationId: z.string().min(1).optional(),
        name: z.string().trim().min(1).max(120).optional(),
        cronExpression: z.string().trim().min(1).max(120).optional(),
        timezone: z.string().trim().min(1).max(120).optional(),
        prefix: z.string().trim().max(512).optional(),
        retentionCount: z
          .number()
          .int()
          .positive()
          .max(3650)
          .nullable()
          .optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWebServerSchedulePermission(ctx, input.id, "backup:manage");
      try {
        const result = await ctx.scope
          .resolve(UpdateWebServerBackupScheduleUseCaseToken)
          .execute(input);
        await ctx.scope.resolve(BackupSchedulerToken).refresh();
        return result;
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  deleteWebServerSchedule: twoFactorVerifiedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertWebServerSchedulePermission(ctx, input.id, "backup:manage");
      try {
        const result = await ctx.scope
          .resolve(DeleteBackupScheduleUseCaseToken)
          .execute(input);
        await ctx.scope.resolve(BackupSchedulerToken).refresh();
        return result;
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  runWebServerNow: twoFactorVerifiedProcedure
    .input(z.object({ scheduleId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertWebServerSchedulePermission(
        ctx,
        input.scheduleId,
        "backup:manage",
      );
      try {
        return await ctx.scope
          .resolve(TriggerBackupRunUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  restoreWebServer: twoFactorVerifiedProcedure
    .input(
      z.object({
        runId: z.string().min(1),
        confirm: z.literal("RESTORE_WEB_SERVER"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const run = await uow.backupRunRepository.findById(input.runId);
      if (run?.kind !== "web-server") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Web-server backup run not found",
        });
      }
      await assertOrganizationPermission(
        ctx,
        run.organizationId,
        "backup:manage",
      );
      try {
        await ctx.scope.resolve(RestoreBackupRunUseCaseToken).execute(input);
        return { restored: true };
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  verifyRun: twoFactorVerifiedProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.scope
        .resolve(UnitOfWorkToken)
        .backupRunRepository.findById(input.runId);
      if (!run)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup run not found",
        });
      await assertOrganizationPermission(
        ctx,
        run.organizationId,
        "backup:manage",
      );
      try {
        return await ctx.scope
          .resolve(VerifyBackupRunUseCaseToken)
          .execute(input.runId);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  listSchedules: twoFactorVerifiedProcedure
    .input(GetBackupSchedulesInputSchema)
    .query(async ({ ctx, input }) => {
      await assertResourcePermission(ctx, input.resourceId, "resource:view");
      try {
        return await ctx.scope
          .resolve(GetBackupSchedulesUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  listRuns: twoFactorVerifiedProcedure
    .input(GetBackupRunsInputSchema)
    .query(async ({ ctx, input }) => {
      await assertResourcePermission(ctx, input.resourceId, "resource:view");
      try {
        return await ctx.scope
          .resolve(GetBackupRunsUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  listVolumes: twoFactorVerifiedProcedure
    .input(ListBackupVolumesInputSchema)
    .query(async ({ ctx, input }) => {
      await assertResourcePermission(ctx, input.resourceId, "resource:view");
      try {
        return await ctx.scope
          .resolve(ListBackupVolumesUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  listComposeServices: twoFactorVerifiedProcedure
    .input(ListComposeServicesInputSchema)
    .query(async ({ ctx, input }) => {
      await assertResourcePermission(ctx, input.resourceId, "resource:view");
      try {
        return await ctx.scope
          .resolve(ListComposeServicesUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  createSchedule: twoFactorVerifiedProcedure
    .input(CreateBackupScheduleInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertResourcePermission(ctx, input.resourceId, "backup:manage");
      try {
        const result = await ctx.scope
          .resolve(CreateBackupScheduleUseCaseToken)
          .execute(input);
        await ctx.scope.resolve(BackupSchedulerToken).refresh();
        return result;
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  updateSchedule: twoFactorVerifiedProcedure
    .input(UpdateBackupScheduleInputSchema)
    .mutation(async ({ ctx, input }) => {
      await resolveResourceBackupScheduleAndCheckPermission(
        ctx,
        input.id,
        "backup:manage",
      );
      try {
        const result = await ctx.scope
          .resolve(UpdateBackupScheduleUseCaseToken)
          .execute(input);
        await ctx.scope.resolve(BackupSchedulerToken).refresh();
        return result;
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  deleteSchedule: twoFactorVerifiedProcedure
    .input(DeleteBackupScheduleInputSchema)
    .mutation(async ({ ctx, input }) => {
      await resolveResourceBackupScheduleAndCheckPermission(
        ctx,
        input.id,
        "backup:manage",
      );
      try {
        const result = await ctx.scope
          .resolve(DeleteBackupScheduleUseCaseToken)
          .execute(input);
        await ctx.scope.resolve(BackupSchedulerToken).refresh();
        return result;
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  runNow: twoFactorVerifiedProcedure
    .input(TriggerBackupRunInputSchema)
    .mutation(async ({ ctx, input }) => {
      await resolveResourceBackupScheduleAndCheckPermission(
        ctx,
        input.scheduleId,
        "backup:manage",
      );
      try {
        return await ctx.scope
          .resolve(TriggerBackupRunUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  restore: twoFactorVerifiedProcedure
    .input(RestoreBackupRunInputSchema)
    .mutation(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const run = await uow.backupRunRepository.findById(input.runId);
      if (!run) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup run not found",
        });
      }
      if (run.kind === "web-server") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Use the web-server restore endpoint",
        });
      }
      if (!run.resourceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Backup run has no resource",
        });
      }
      await assertResourcePermission(ctx, run.resourceId, "backup:manage");
      try {
        await ctx.scope.resolve(RestoreBackupRunUseCaseToken).execute(input);
        return { restored: true };
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
