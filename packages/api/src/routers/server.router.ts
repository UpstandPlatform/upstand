import { TRPCError } from "@trpc/server";
import {
  ConfirmWorkloadMigrationInputSchema,
  ControlDockerContainerInputSchema,
  ControlDockerResourceInputSchema,
  CreateServerInputSchema,
  DeleteServerInputSchema,
  GetDockerInventoryInputSchema,
  GetServerCountInputSchema,
  GetServerHistoricalMetricsInputSchema,
  GetServerInputSchema,
  GetServerMonitoringStatusInputSchema,
  GetServerRuntimeStatsInputSchema,
  GetServersInputSchema,
  getConfiguredControlPlaneMode,
  MigrateResourceInputSchema,
  ResourceWorkloadMigrationInputSchema,
  ScanServerHostKeyInputSchema,
  SetupServerInputSchema,
  UpdateMonitoringSettingsInputSchema,
  UpdateServerInputSchema,
  WorkloadMigrationIdInputSchema,
} from "@upstand/usecases";
import {
  CancelWorkloadMigrationUseCaseToken,
  ConfirmWorkloadMigrationUseCaseToken,
  CreateServerUseCaseToken,
  DeleteServerUseCaseToken,
  GetDockerInventoryUseCaseToken,
  GetResourceWorkloadMigrationUseCaseToken,
  GetServerCountUseCaseToken,
  GetServerHistoricalMetricsUseCaseToken,
  GetServerMonitoringStatusUseCaseToken,
  GetServerRuntimeStatsUseCaseToken,
  GetServersUseCaseToken,
  GetServerUseCaseToken,
  GetWorkloadMigrationUseCaseToken,
  MigrateResourceUseCaseToken,
  RollbackWorkloadMigrationUseCaseToken,
  ScanServerHostKeyUseCaseToken,
  SetupServerUseCaseToken,
  UnitOfWorkToken,
  UpdateMonitoringSettingsUseCaseToken,
  UpdateServerUseCaseToken,
} from "@upstand/usecases/tokens";
import { z } from "zod";
import { handleUseCaseError } from "../errors";
import {
  protectedProcedure,
  router,
  twoFactorVerifiedProcedure,
} from "../index";
import { requireInstanceOwnerContext } from "../instance-access";
import { checkPermission } from "../permissions";
import { authorizeServerAccess } from "../trpc/server-authorization.helper";

async function requireLocalDockerOwner(
  ctx: Parameters<typeof requireInstanceOwnerContext>[0],
  serverId: string | undefined,
): Promise<void> {
  if (!serverId || serverId === "local" || serverId === "manager") {
    if (getConfiguredControlPlaneMode() === "desktop") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Desktop bare mode does not expose local Docker operations",
      });
    }
    await requireInstanceOwnerContext(ctx);
  }
}

export const serverRouter = router({
  count: twoFactorVerifiedProcedure
    .input(GetServerCountInputSchema)
    .query(async ({ ctx, input }) => {
      await authorizeServerAccess(ctx, input.organizationId, "server:view");
      try {
        return await ctx.scope
          .resolve(GetServerCountUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  one: twoFactorVerifiedProcedure
    .input(GetServerInputSchema)
    .query(async ({ ctx, input }) => {
      await authorizeServerAccess(ctx, input.organizationId, "server:view");
      try {
        return await ctx.scope.resolve(GetServerUseCaseToken).execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  controlContainer: twoFactorVerifiedProcedure
    .input(ControlDockerContainerInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeServerAccess(ctx, input.organizationId, "server:update");
      await requireLocalDockerOwner(ctx, input.serverId);
      const useCase = ctx.scope.resolve(GetDockerInventoryUseCaseToken);
      try {
        return await useCase.controlContainer(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  controlResource: twoFactorVerifiedProcedure
    .input(ControlDockerResourceInputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeServerAccess(ctx, input.organizationId, "server:update");
      await requireLocalDockerOwner(ctx, input.serverId);
      const useCase = ctx.scope.resolve(GetDockerInventoryUseCaseToken);
      try {
        return await useCase.controlResource(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  validate: twoFactorVerifiedProcedure
    .input(
      GetDockerInventoryInputSchema.pick({
        organizationId: true,
        serverId: true,
      }).extend({
        serverId: GetDockerInventoryInputSchema.shape.serverId.unwrap(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:view",
      );
      await requireLocalDockerOwner(ctx, input.serverId);
      const useCase = ctx.scope.resolve(GetDockerInventoryUseCaseToken);
      try {
        return await useCase.execute({
          organizationId: input.organizationId,
          serverId: input.serverId,
          kind: "info",
          tail: 150,
        });
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  time: twoFactorVerifiedProcedure
    .input(
      GetDockerInventoryInputSchema.pick({
        organizationId: true,
        serverId: true,
      }).extend({
        serverId: GetDockerInventoryInputSchema.shape.serverId.unwrap(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:view",
      );
      await requireLocalDockerOwner(ctx, input.serverId);
      const useCase = ctx.scope.resolve(GetDockerInventoryUseCaseToken);
      try {
        return await useCase.getHostTime(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  inventory: twoFactorVerifiedProcedure
    .input(GetDockerInventoryInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:view",
      );
      await requireLocalDockerOwner(ctx, input.serverId);
      const useCase = ctx.scope.resolve(GetDockerInventoryUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  runtimeStats: twoFactorVerifiedProcedure
    .input(GetServerRuntimeStatsInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:view",
      );
      await requireLocalDockerOwner(ctx, input.serverId);

      const useCase = ctx.scope.resolve(GetServerRuntimeStatsUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  monitoringSettings: twoFactorVerifiedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        serverId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:view",
      );
      await requireLocalDockerOwner(ctx, input.serverId);

      const uow = ctx.scope.resolve(UnitOfWorkToken);
      if (input.serverId !== "local") {
        const server = await uow.serverRepository.findById(input.serverId);
        if (!server || server.organizationId !== input.organizationId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Server not found",
          });
        }
      }

      const settings = await uow.monitoringSettingsRepository.findByServerId(
        input.serverId,
      );
      return {
        serverId: input.serverId,
        isConfigured: Boolean(settings),
        cpuThreshold: settings?.cpuThreshold ?? 90,
        memoryThreshold: settings?.memoryThreshold ?? 90,
      };
    }),

  create: twoFactorVerifiedProcedure
    .input(CreateServerInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:create",
      );

      const useCase = ctx.scope.resolve(CreateServerUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  list: twoFactorVerifiedProcedure
    .input(GetServersInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:view",
      );

      const useCase = ctx.scope.resolve(GetServersUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  delete: twoFactorVerifiedProcedure
    .input(DeleteServerInputSchema)
    .mutation(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const server = await uow.serverRepository.findById(input.id);
      if (!server) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Server not found",
        });
      }

      await checkPermission(
        ctx.session.user.id,
        server.organizationId,
        "server:delete",
      );

      const useCase = ctx.scope.resolve(DeleteServerUseCaseToken);
      try {
        return await useCase.execute({
          ...input,
          organizationId: server.organizationId,
        });
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  setup: twoFactorVerifiedProcedure
    .input(SetupServerInputSchema)
    .mutation(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const server = await uow.serverRepository.findById(input.id);
      if (!server) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Server not found",
        });
      }

      await checkPermission(
        ctx.session.user.id,
        server.organizationId,
        "server:create",
      );

      const useCase = ctx.scope.resolve(SetupServerUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        if (error instanceof Error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
            cause: error,
          });
        }
        handleUseCaseError(error, ctx.log);
      }
    }),

  setupProgress: twoFactorVerifiedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const server = await uow.serverRepository.findById(input.id);
      if (!server) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Server not found",
        });
      }

      await checkPermission(
        ctx.session.user.id,
        server.organizationId,
        "server:view",
      );

      return {
        id: server.id,
        status: server.status,
        setupStage: server.setupStage ?? null,
        setupLogs: server.setupLogs ?? null,
        setupError: server.setupError ?? null,
        updatedAt: server.updatedAt,
      };
    }),

  scanHostKey: twoFactorVerifiedProcedure
    .input(ScanServerHostKeyInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:create",
      );
      const useCase = ctx.scope.resolve(ScanServerHostKeyUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        if (error instanceof Error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
            cause: error,
          });
        }
        handleUseCaseError(error, ctx.log);
      }
    }),

  update: twoFactorVerifiedProcedure
    .input(UpdateServerInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:update",
      );
      try {
        return await ctx.scope.resolve(UpdateServerUseCaseToken).execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  updateMonitoringSettings: twoFactorVerifiedProcedure
    .input(UpdateMonitoringSettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:update",
      );
      await requireLocalDockerOwner(ctx, input.serverId);
      try {
        return await ctx.scope
          .resolve(UpdateMonitoringSettingsUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  historicalMetrics: twoFactorVerifiedProcedure
    .input(GetServerHistoricalMetricsInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:view",
      );
      await requireLocalDockerOwner(ctx, input.serverId);

      const useCase = ctx.scope.resolve(GetServerHistoricalMetricsUseCaseToken);
      try {
        return await useCase.execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  monitoringStatus: twoFactorVerifiedProcedure
    .input(GetServerMonitoringStatusInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:view",
      );
      await requireLocalDockerOwner(ctx, input.serverId);
      try {
        return await ctx.scope
          .resolve(GetServerMonitoringStatusUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  migrateResource: protectedProcedure
    .input(MigrateResourceInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:update",
      );
      try {
        return await ctx.scope
          .resolve(MigrateResourceUseCaseToken)
          .execute({ ...input, correlationId: ctx.correlationId });
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  getWorkloadMigration: protectedProcedure
    .input(WorkloadMigrationIdInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:view",
      );
      try {
        return await ctx.scope
          .resolve(GetWorkloadMigrationUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  getResourceWorkloadMigration: protectedProcedure
    .input(ResourceWorkloadMigrationInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:view",
      );
      try {
        return await ctx.scope
          .resolve(GetResourceWorkloadMigrationUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  cancelWorkloadMigration: protectedProcedure
    .input(WorkloadMigrationIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:update",
      );
      try {
        return await ctx.scope
          .resolve(CancelWorkloadMigrationUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  rollbackWorkloadMigration: protectedProcedure
    .input(WorkloadMigrationIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:update",
      );
      try {
        return await ctx.scope
          .resolve(RollbackWorkloadMigrationUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  confirmWorkloadMigration: protectedProcedure
    .input(ConfirmWorkloadMigrationInputSchema)
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:update",
      );
      try {
        return await ctx.scope
          .resolve(ConfirmWorkloadMigrationUseCaseToken)
          .execute(input);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
