import { env } from "@upstand/env/server";
import type {
  DockerCleanupCommand,
  NotificationPublisher,
} from "@upstand/usecases";
import {
  DockerHostMaintenancePortToken,
  PublishNotificationUseCaseToken,
} from "@upstand/usecases/tokens";
import { z } from "zod";
import type { AuthenticatedContext } from "../context";
import { getErrorMessage } from "../errors";
import { requireInstanceOwnerContext } from "../instance-access";

export async function queueDockerCleanupNotification(
  publisher: NotificationPublisher,
  logger: Pick<AuthenticatedContext["log"], "error">,
  input: {
    success: boolean;
    organizationId?: string;
    title: string;
    message: string;
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
  },
): Promise<void> {
  await publisher
    .execute({
      event: input.success
        ? "docker_cleanup_completed"
        : "docker_cleanup_failed",
      organizationId: input.organizationId,
      title: input.title,
      message: input.message,
      metadata: {
        ...input.metadata,
        event: input.success
          ? "docker_cleanup_completed"
          : "docker_cleanup_failed",
      },
      idempotencyKey: input.idempotencyKey,
    })
    .catch((error) => {
      logger.error(error instanceof Error ? error : String(error), {
        message: "Unable to queue Docker cleanup notification",
      });
    });
}

export const UPSTAND_SERVER_SERVICE = "upstand_server";
export const UPSTAND_REDIS_SERVICE = "upstand_redis";
export const CleanupInputSchema = z.object({
  organizationId: z.string().min(1),
  confirm: z.literal("CLEANUP"),
  preserveRollbackImages: z.boolean().default(true),
  pruneNetworks: z.boolean().default(false),
});

export async function requireWebServerOwner(
  ctx: AuthenticatedContext,
): Promise<void> {
  await requireInstanceOwnerContext(ctx);
}

export async function runDockerCleanup(
  ctx: AuthenticatedContext,
  command: DockerCleanupCommand,
  failureMessage: string,
  organizationId: string,
  options: {
    preserveRollbackImages?: boolean;
    pruneNetworks?: boolean;
  } = {},
): Promise<{ success: true }> {
  await requireInstanceOwnerContext(ctx);
  const publisher = ctx.scope.resolve(PublishNotificationUseCaseToken);
  try {
    await ctx.scope
      .resolve(DockerHostMaintenancePortToken)
      .cleanupDocker(command, options);
    await queueDockerCleanupNotification(publisher, ctx.log, {
      success: true,
      organizationId,
      title: "🧹 Docker cleanup completed",
      message: "Upstand completed a Docker cleanup operation.",
    });
    return { success: true };
  } catch (error) {
    const message = getErrorMessage(error, failureMessage);
    await queueDockerCleanupNotification(publisher, ctx.log, {
      success: false,
      organizationId,
      title: "🧹 Docker cleanup failed",
      message,
      metadata: { error: message },
    });
    throw new Error(message);
  }
}

export async function getRedisPassword(): Promise<string> {
  return resolveRedisPassword(env.REDIS_PASSWORD);
}

export function resolveRedisPassword(
  runtimePassword: string | undefined,
): string {
  if (runtimePassword) return runtimePassword;
  throw new Error("Redis password is not configured in the runtime.");
}
