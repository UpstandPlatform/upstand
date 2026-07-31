import type { ServiceScope } from "@circulo-ai/di";
import {
  getConfiguredControlPlaneMode,
  InitSwarmInputSchema,
  RemoveSwarmNodeInputSchema,
  RotateSwarmJoinTokenInputSchema,
  UpdateSwarmNodeInputSchema,
} from "@upstand/usecases";
import {
  GetSwarmContainersUseCaseToken,
  GetSwarmInfoUseCaseToken,
  GetSwarmJoinCommandsUseCaseToken,
  GetSwarmNodesUseCaseToken,
  InitSwarmUseCaseToken,
  PublishNotificationUseCaseToken,
  RemoveSwarmNodeUseCaseToken,
  RotateSwarmJoinTokenUseCaseToken,
  UpdateSwarmNodeUseCaseToken,
} from "@upstand/usecases/tokens";
import { z } from "zod";
import type { AuthenticatedContext } from "../context";
import { handleUseCaseError } from "../errors";
import { router, twoFactorVerifiedProcedure } from "../index";
import { requireInstanceOwnerContext } from "../instance-access";
import { authorizeContextCapability } from "../permissions";

const SwarmOrganizationInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
});

async function requireClusterOwner(
  ctx: AuthenticatedContext,
  organizationId: string,
) {
  if (getConfiguredControlPlaneMode() === "cloud") {
    await requireInstanceOwnerContext(ctx);
  }
  await authorizeContextCapability(ctx, organizationId, "swarm:manage");
}

function auditClusterOperation({
  action,
  organizationId,
  userId,
  target,
  logger,
}: {
  action: string;
  organizationId: string;
  userId: string;
  target?: string;
  logger: Pick<AuthenticatedContext["log"], "info">;
}) {
  logger.info("Docker Swarm control-plane operation completed", {
    action,
    organizationId,
    userId,
    ...(target ? { target } : {}),
  });
}

async function notifyClusterOperation(
  scope: Pick<ServiceScope, "resolve">,
  logger: Pick<AuthenticatedContext["log"], "error">,
  input: {
    organizationId: string;
    event:
      | "cluster_initialized"
      | "cluster_node_updated"
      | "cluster_node_removed"
      | "cluster_token_rotated";
    title: string;
    message: string;
    metadata?: Record<string, unknown>;
  },
) {
  await scope
    .resolve(PublishNotificationUseCaseToken)
    .execute({
      ...input,
      idempotencyKey: `cluster:${input.event}:${input.organizationId}:${JSON.stringify(input.metadata ?? {})}`,
      metadata: {
        event: input.event,
        ...(input.metadata ?? {}),
      },
    })
    .catch((error) => {
      logger.error(error instanceof Error ? error : String(error), {
        message: "Unable to queue cluster notification",
        event: input.event,
        organizationId: input.organizationId,
      });
    });
}

export const swarmRouter = router({
  getInfo: twoFactorVerifiedProcedure
    .input(SwarmOrganizationInputSchema)
    .query(async ({ ctx, input }) => {
      await requireClusterOwner(ctx, input.organizationId);
      const useCase = ctx.scope.resolve(GetSwarmInfoUseCaseToken);
      try {
        return await useCase.execute();
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  getNodes: twoFactorVerifiedProcedure
    .input(SwarmOrganizationInputSchema)
    .query(async ({ ctx, input }) => {
      await requireClusterOwner(ctx, input.organizationId);
      const useCase = ctx.scope.resolve(GetSwarmNodesUseCaseToken);
      try {
        return await useCase.execute();
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  updateNode: twoFactorVerifiedProcedure
    .input(
      SwarmOrganizationInputSchema.extend(UpdateSwarmNodeInputSchema.shape),
    )
    .mutation(async ({ ctx, input }) => {
      await requireClusterOwner(ctx, input.organizationId);
      const useCase = ctx.scope.resolve(UpdateSwarmNodeUseCaseToken);
      try {
        const result = await useCase.execute(input);
        auditClusterOperation({
          action: "node.update",
          organizationId: input.organizationId,
          userId: ctx.session.user.id,
          target: input.nodeId,
          logger: ctx.log,
        });
        await notifyClusterOperation(ctx.scope, ctx.log, {
          organizationId: input.organizationId,
          event: "cluster_node_updated",
          title: "Docker Swarm node updated",
          message: `Swarm node ${input.nodeId} was updated.`,
          metadata: {
            nodeId: input.nodeId,
            availability: input.availability,
            role: input.role,
          },
        });
        return result;
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  initSwarm: twoFactorVerifiedProcedure
    .input(SwarmOrganizationInputSchema.extend(InitSwarmInputSchema.shape))
    .mutation(async ({ ctx, input }) => {
      await requireClusterOwner(ctx, input.organizationId);
      const useCase = ctx.scope.resolve(InitSwarmUseCaseToken);
      try {
        const result = await useCase.execute(input);
        auditClusterOperation({
          action: "cluster.initialize",
          organizationId: input.organizationId,
          userId: ctx.session.user.id,
          target: input.advertiseAddr,
          logger: ctx.log,
        });
        await notifyClusterOperation(ctx.scope, ctx.log, {
          organizationId: input.organizationId,
          event: "cluster_initialized",
          title: "Docker Swarm cluster initialized",
          message:
            "Upstand initialized Docker Swarm and prepared its overlay network.",
          metadata: {
            swarmId: result.swarmId,
            networkName: result.networkName,
          },
        });
        return result;
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  removeNode: twoFactorVerifiedProcedure
    .input(
      SwarmOrganizationInputSchema.extend(RemoveSwarmNodeInputSchema.shape),
    )
    .mutation(async ({ ctx, input }) => {
      await requireClusterOwner(ctx, input.organizationId);
      const useCase = ctx.scope.resolve(RemoveSwarmNodeUseCaseToken);
      try {
        const result = await useCase.execute(input);
        auditClusterOperation({
          action: "node.remove",
          organizationId: input.organizationId,
          userId: ctx.session.user.id,
          target: input.nodeId,
          logger: ctx.log,
        });
        await notifyClusterOperation(ctx.scope, ctx.log, {
          organizationId: input.organizationId,
          event: "cluster_node_removed",
          title: "Docker Swarm node removed",
          message: `Swarm node ${input.nodeId} was drained and removed.`,
          metadata: { nodeId: input.nodeId },
        });
        return result;
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  getJoinCommands: twoFactorVerifiedProcedure
    .input(SwarmOrganizationInputSchema)
    .query(async ({ ctx, input }) => {
      await requireClusterOwner(ctx, input.organizationId);
      const useCase = ctx.scope.resolve(GetSwarmJoinCommandsUseCaseToken);
      try {
        const result = await useCase.execute();
        auditClusterOperation({
          action: "join-credentials.reveal",
          organizationId: input.organizationId,
          userId: ctx.session.user.id,
          logger: ctx.log,
        });
        return result;
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  getJoinCommand: twoFactorVerifiedProcedure
    .input(
      SwarmOrganizationInputSchema.extend({
        role: z.enum(["worker", "manager"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireClusterOwner(ctx, input.organizationId);
      const result = await ctx.scope
        .resolve(GetSwarmJoinCommandsUseCaseToken)
        .execute();
      auditClusterOperation({
        action: `join-credentials.reveal.${input.role}`,
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
        logger: ctx.log,
      });
      return {
        role: input.role,
        command:
          input.role === "worker"
            ? result.workerCommand
            : result.managerCommand,
        advertiseAddress: result.advertiseAddress,
      };
    }),

  rotateJoinToken: twoFactorVerifiedProcedure
    .input(
      SwarmOrganizationInputSchema.extend(
        RotateSwarmJoinTokenInputSchema.shape,
      ),
    )
    .mutation(async ({ ctx, input }) => {
      await requireClusterOwner(ctx, input.organizationId);
      const useCase = ctx.scope.resolve(RotateSwarmJoinTokenUseCaseToken);
      try {
        const result = await useCase.execute(input);
        auditClusterOperation({
          action: `join-token.rotate.${input.role}`,
          organizationId: input.organizationId,
          userId: ctx.session.user.id,
          logger: ctx.log,
        });
        await notifyClusterOperation(ctx.scope, ctx.log, {
          organizationId: input.organizationId,
          event: "cluster_token_rotated",
          title: `Docker Swarm ${input.role} token rotated`,
          message: `The ${input.role} join token was rotated.`,
          metadata: { role: input.role },
        });
        return result;
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),

  getTasks: twoFactorVerifiedProcedure
    .input(SwarmOrganizationInputSchema)
    .query(async ({ ctx, input }) => {
      await requireClusterOwner(ctx, input.organizationId);
      const useCase = ctx.scope.resolve(GetSwarmContainersUseCaseToken);
      try {
        return await useCase.execute();
      } catch (error) {
        handleUseCaseError(error, ctx.log);
      }
    }),
});
