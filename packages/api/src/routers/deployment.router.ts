import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { redis, withRedisTimeout } from "@upstand/redis";
import {
  getConfiguredControlPlaneMode,
  getDeploymentQueueName,
  getPlatformCapabilities,
} from "@upstand/usecases";
import {
  DeployResourceUseCaseToken,
  GetDeploymentServerSettingsUseCaseToken,
  GetDeploymentsUseCaseToken,
  GetQueueUseCaseToken,
  GetRequestsUseCaseToken,
  UnitOfWorkToken,
  UpdateConcurrencyUseCaseToken,
} from "@upstand/usecases/tokens";
import { Queue } from "bullmq";
import { z } from "zod";
import type { AuthenticatedContext } from "../context";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { authorizeContextCapability, checkPermission } from "../permissions";
import { resolveResourceTarget } from "./shared/resource-authorization";

const OrganizationInputSchema = z.object({
  organizationId: z.string().min(1),
});

const CancelDeploymentInputSchema = z.object({
  deploymentId: z.string().min(1),
});

async function getDeploymentScope(
  ctx: AuthenticatedContext,
  deploymentId: string,
  permission: "resource:view" | "resource:update",
) {
  const uow = ctx.scope.resolve(UnitOfWorkToken);
  const deployment = await uow.deploymentRepository.findById(deploymentId);
  if (!deployment) throw new ValidationError("Deployment not found");
  const resource = await uow.resourceRepository.findById(deployment.resourceId);
  if (!resource) throw new ValidationError("Deployment resource not found");
  const environment = await uow.environmentRepository.findById(
    resource.environmentId,
  );
  const project = environment
    ? await uow.projectRepository.findById(environment.projectId)
    : null;
  if (!project) throw new ValidationError("Deployment project not found");
  await authorizeContextCapability(ctx, project.organizationId, permission);
  if (permission !== "resource:view" && project.archivedAt) {
    throw new ValidationError(
      "Project is archived. Unarchive it before modifying resources.",
    );
  }
  return { uow, deployment, resource, project };
}

async function markDeploymentCancelled(
  uow: IUnitOfWork,
  deploymentId: string,
): Promise<void> {
  await uow.transaction(async (tx: IUnitOfWork) => {
    const deployment = await tx.deploymentRepository.findById(deploymentId);
    if (
      !deployment ||
      ["success", "failed", "stale", "cancelled"].includes(deployment.status)
    ) {
      return;
    }
    await tx.deploymentRepository.updateById(deploymentId, {
      status: "cancelled",
      logs: `${deployment.logs}\nDeployment cancelled by user. 🛑\n`,
    });
    const resource = await tx.resourceRepository.findById(
      deployment.resourceId,
    );
    if (resource?.status === "queued") {
      await tx.resourceRepository.updateById(deployment.resourceId, {
        status: "stopped",
      });
    }
  });
}

export const deploymentRouter = router({
  getByResource: twoFactorVerifiedProcedure
    .input(z.object({ resourceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const { organizationId } = await resolveResourceTarget(
        ctx,
        input.resourceId,
      );
      await authorizeContextCapability(ctx, organizationId, "resource:view");
      return uow.deploymentRepository.findByResourceId(input.resourceId);
    }),

  getLogs: twoFactorVerifiedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { deployment } = await getDeploymentScope(
        ctx,
        input.id,
        "resource:view",
      );
      return {
        id: deployment.id,
        status: deployment.status,
        logs: deployment.logs ?? "",
        lastError: deployment.lastError ?? null,
      };
    }),

  retryDeployment: twoFactorVerifiedProcedure
    .input(z.object({ deploymentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { deployment, resource } = await getDeploymentScope(
        ctx,
        input.deploymentId,
        "resource:update",
      );
      if (!["failed", "stale", "cancelled"].includes(deployment.status)) {
        throw new ValidationError(
          "Only failed, stale, or cancelled deployments can be retried",
        );
      }
      try {
        return await ctx.scope.resolve(DeployResourceUseCaseToken).execute({
          id: resource.id,
          sourceRevision: deployment.sourceRevision ?? undefined,
          title: `Retry: ${deployment.title}`,
        });
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  getDeployments: twoFactorVerifiedProcedure
    .input(OrganizationInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "project:view",
      );
      const useCase = ctx.scope.resolve(GetDeploymentsUseCaseToken);
      try {
        return await useCase.executeForOrganization(input.organizationId);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  getQueue: twoFactorVerifiedProcedure
    .input(OrganizationInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "project:view",
      );
      const useCase = ctx.scope.resolve(GetQueueUseCaseToken);
      try {
        return await useCase.executeForOrganization(input.organizationId);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  getRequests: twoFactorVerifiedProcedure
    .input(OrganizationInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "project:view",
      );
      const useCase = ctx.scope.resolve(GetRequestsUseCaseToken);
      try {
        return await useCase.execute(input.organizationId);
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  getServerSettings: twoFactorVerifiedProcedure
    .input(OrganizationInputSchema)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:view",
      );
      try {
        return await ctx.scope
          .resolve(GetDeploymentServerSettingsUseCaseToken)
          .execute(input.organizationId, {
            includeLocal: getPlatformCapabilities(
              getConfiguredControlPlaneMode(),
            ).localRuntime,
          });
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  updateServerConcurrency: twoFactorVerifiedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        serverId: z.string().min(1),
        concurrency: z.number().int().min(1).max(100),
        hostname: z.string().optional(),
        ip: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "server:update",
      );
      const useCase = ctx.scope.resolve(UpdateConcurrencyUseCaseToken);
      try {
        return await useCase.execute({
          ...input,
          allowLocal: getPlatformCapabilities(getConfiguredControlPlaneMode())
            .localRuntime,
        });
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  cancelDeploymentJob: twoFactorVerifiedProcedure
    .input(CancelDeploymentInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const deploymentId = input.deploymentId;
        const scope = await getDeploymentScope(
          ctx,
          deploymentId,
          "resource:update",
        );
        const serverId = scope.deployment.serverId || "local";

        await withRedisTimeout(
          redis.set(
            `upstand:deployment:cancel:${deploymentId}`,
            "1",
            "EX",
            3600,
          ),
        );

        const queue = new Queue(getDeploymentQueueName(serverId), {
          connection: redis.options,
        });
        const job = await queue.getJob(deploymentId);

        if (job && queue) {
          const state = await job.getState();
          if (state === "active") {
            await queue.close();
            return { success: true, state, cancellationRequested: true };
          }
          await job.remove();
          await queue.close();
          await markDeploymentCancelled(scope.uow, deploymentId);
          return { success: true, state, cancellationRequested: false };
        }

        // The outbox publisher may not have created the BullMQ job yet. The
        // cancellation marker prevents a later publish, so complete the DB
        // transition instead of incorrectly reporting "Job not found".
        if (
          ["queued", "waiting", "retrying"].includes(scope.deployment.status)
        ) {
          await markDeploymentCancelled(scope.uow, deploymentId);
          return {
            success: true,
            state: scope.deployment.status,
            cancellationRequested: false,
          };
        }

        throw new ValidationError("Deployment job not found in queue");
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  killBuild: twoFactorVerifiedProcedure
    .input(z.object({ deploymentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { deployment } = await getDeploymentScope(
        ctx,
        input.deploymentId,
        "resource:update",
      );
      const queue = new Queue(
        getDeploymentQueueName(deployment.serverId || "local"),
        { connection: redis.options },
      );
      try {
        const job = await queue.getJob(input.deploymentId);
        if (!job)
          throw new ValidationError("Deployment job not found in queue");
        const state = await job.getState();
        if (state === "active") {
          await withRedisTimeout(
            redis.set(
              `upstand:deployment:cancel:${input.deploymentId}`,
              "1",
              "EX",
              3600,
            ),
          );
          return { success: true, state, cancellationRequested: true };
        }
        await job.remove();
        await markDeploymentCancelled(
          ctx.scope.resolve(UnitOfWorkToken),
          input.deploymentId,
        );
        return { success: true, state, cancellationRequested: false };
      } finally {
        await queue.close();
      }
    }),

  removeDeployment: twoFactorVerifiedProcedure
    .input(z.object({ deploymentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { uow, deployment } = await getDeploymentScope(
        ctx,
        input.deploymentId,
        "resource:update",
      );
      if (
        !["success", "failed", "stale", "cancelled"].includes(deployment.status)
      ) {
        throw new ValidationError("Only completed deployments can be removed");
      }
      await uow.transaction(async (tx: IUnitOfWork) => {
        await tx.deploymentRepository.deleteById(deployment.id);
      });
      return { success: true };
    }),

  clearHistory: twoFactorVerifiedProcedure
    .input(z.object({ resourceId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const uow = ctx.scope.resolve(UnitOfWorkToken);
      const resource = await uow.resourceRepository.findById(input.resourceId);
      if (!resource) throw new ValidationError("Resource not found");
      const environment = await uow.environmentRepository.findById(
        resource.environmentId,
      );
      const project = environment
        ? await uow.projectRepository.findById(environment.projectId)
        : null;
      if (!project) throw new ValidationError("Project not found");
      await checkPermission(
        ctx.session.user.id,
        project.organizationId,
        "resource:update",
      );
      const deployments = await uow.deploymentRepository.findByResourceId(
        input.resourceId,
      );
      await uow.transaction(async (tx: IUnitOfWork) => {
        for (const deployment of deployments) {
          if (
            ["success", "failed", "stale", "cancelled"].includes(
              deployment.status,
            )
          ) {
            await tx.deploymentRepository.deleteById(deployment.id);
          }
        }
      });
      return { success: true };
    }),
});
