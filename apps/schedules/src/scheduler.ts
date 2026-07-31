import type { Server } from "@upstand/domain";
import { DockerCleanupService } from "@upstand/infrastructure";
import {
  AccessLogCleanupScheduler,
  AutoscalingService,
  type NotificationPublisher,
  resolveDockerCliEnvironmentForServer,
} from "@upstand/usecases";
import {
  BackupSchedulerToken,
  CaddyServiceToken,
  DockerServiceToken,
  GeneralSchedulerToken,
  GetUpdateStatusUseCaseToken,
  PublishNotificationUseCaseToken,
  ReconcileStaleDeploymentsUseCaseToken,
  RunDueSecretRotationsUseCaseToken,
  UnitOfWorkToken,
} from "@upstand/usecases/tokens";
import { log } from "evlog";
import { getServiceProvider } from "./di";

export class ScheduledDockerCleanup {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRunDate: string | null = null;
  private activeDate: string | null = null;
  private readonly completedTargets = new Set<string>();
  private running = false;

  constructor(
    private readonly dockerCleanupService = new DockerCleanupService(),
  ) {}

  start(): void {
    this.timer = setInterval(
      () => {
        this.run().catch((error: unknown) => {
          log.error({
            message: "Unhandled error in ScheduledDockerCleanup timer",
            err: error,
          });
        });
      },
      60 * 60 * 1000,
    );
    this.timer.unref?.();
    void this.run().catch((error: unknown) => {
      log.error({
        message: "Unhandled error in ScheduledDockerCleanup initial run",
        err: error,
      });
    });
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async run(): Promise<void> {
    if (this.running) return;

    const now = new Date();
    const date = getLocalDateKey(now);
    if (now.getHours() < 3 || this.lastRunDate === date) return;

    if (this.activeDate !== date) {
      this.activeDate = date;
      this.completedTargets.clear();
    }
    this.running = true;

    const scope = getServiceProvider().createScope();
    try {
      const uow = scope.resolve(UnitOfWorkToken);
      const settings = await uow.webServerSettingsRepository.findGlobal();
      const publisher = scope.resolve(PublishNotificationUseCaseToken);

      if (settings?.dailyDockerCleanup && !this.completedTargets.has("local")) {
        log.info({ message: "Running scheduled local Docker cleanup... 🧹" });
        try {
          await this.dockerCleanupService.run("all");
          this.completedTargets.add("local");
          await publishDockerCleanupNotification(publisher, {
            success: true,
            idempotencyKey: `docker-cleanup:local:${date}`,
            title: "🧹 Docker Cleanup Completed",
            message:
              "Upstand successfully executed the scheduled daily cleanup of unused Docker images, stopped containers, and dangling build caches.",
            metadata: { date, scope: "local" },
          });
        } catch (error: unknown) {
          await publishDockerCleanupNotification(publisher, {
            success: false,
            idempotencyKey: `docker-cleanup-failed:local:${date}`,
            title: "🧹 Docker Cleanup Failed",
            message: getCleanupErrorMessage(error),
            metadata: {
              date,
              scope: "local",
              error: getCleanupErrorMessage(error),
            },
          });
          log.error({
            message: "Failed to run scheduled local Docker cleanup",
            err: error,
          });
        }
      }

      const servers = await uow.serverRepository.findMany();
      const eligibleServers = servers.filter(
        (candidate: Server) =>
          candidate.enableDockerCleanup &&
          !this.completedTargets.has(candidate.id),
      );

      await Promise.allSettled(
        eligibleServers.map(async (server: Server) => {
          let remote: Awaited<
            ReturnType<typeof resolveDockerCliEnvironmentForServer>
          > | null = null;
          try {
            remote = await resolveDockerCliEnvironmentForServer(server.id, uow);
            log.info({
              message: `Running scheduled Docker cleanup on remote server '${server.name}'... 🧹`,
              serverId: server.id,
            });

            // Enforce a 5-minute timeout for remote execution
            let timerHandle: ReturnType<typeof setTimeout> | undefined;
            const cleanupPromise = this.dockerCleanupService.run(
              "all",
              remote.environment,
            );
            const timeoutPromise = new Promise<never>((_, reject) => {
              timerHandle = setTimeout(
                () =>
                  reject(
                    new Error(
                      "Remote Docker cleanup timed out after 5 minutes",
                    ),
                  ),
                300_000,
              );
            });

            try {
              await Promise.race([cleanupPromise, timeoutPromise]);
            } finally {
              if (timerHandle) clearTimeout(timerHandle);
            }
            this.completedTargets.add(server.id);
            await publishDockerCleanupNotification(publisher, {
              success: true,
              idempotencyKey: `docker-cleanup:${server.id}:${date}`,
              title: `🧹 Docker cleanup completed on ${server.name}`,
              message: `Upstand completed the scheduled cleanup of unused Docker resources on ${server.name}.`,
              metadata: {
                date,
                scope: "remote",
                serverId: server.id,
                serverName: server.name,
              },
            });
          } catch (error: unknown) {
            const message = getCleanupErrorMessage(error);
            await publishDockerCleanupNotification(publisher, {
              success: false,
              idempotencyKey: `docker-cleanup-failed:${server.id}:${date}`,
              title: `🧹 Docker cleanup failed on ${server.name}`,
              message,
              metadata: {
                date,
                scope: "remote",
                serverId: server.id,
                serverName: server.name,
                error: message,
              },
            });
            log.error({
              message: "Failed to run scheduled remote Docker cleanup",
              serverId: server.id,
              err: error,
            });
          } finally {
            remote?.cleanup();
          }
        }),
      );

      const hasPendingTargets =
        Boolean(
          settings?.dailyDockerCleanup && !this.completedTargets.has("local"),
        ) ||
        servers.some(
          (server: Server) =>
            server.enableDockerCleanup && !this.completedTargets.has(server.id),
        );
      if (!hasPendingTargets) this.lastRunDate = date;
    } catch (error: unknown) {
      log.error({
        message: "Failed to run scheduled Docker cleanup",
        err: error,
      });
    } finally {
      this.running = false;
      await scope.dispose();
    }
  }
}

function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCleanupErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function publishDockerCleanupNotification(
  publisher: NotificationPublisher,
  input: {
    success: boolean;
    title: string;
    message: string;
    metadata: Record<string, unknown>;
    idempotencyKey: string;
  },
): Promise<void> {
  await publisher
    .execute({
      event: input.success
        ? "docker_cleanup_completed"
        : "docker_cleanup_failed",
      idempotencyKey: input.idempotencyKey,
      title: input.title,
      message: input.message,
      metadata: {
        ...input.metadata,
        event: input.success
          ? "docker_cleanup_completed"
          : "docker_cleanup_failed",
      },
    })
    .catch((notificationError: unknown) => {
      log.error({
        message: "Unable to queue Docker cleanup notification",
        err: getCleanupErrorMessage(notificationError),
        event: input.success
          ? "docker_cleanup_completed"
          : "docker_cleanup_failed",
      });
    });
}

export class UpstandUpdateNotificationScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.timer = setInterval(
      () => {
        this.run().catch((error: unknown) => {
          log.error({
            message:
              "Unhandled error in UpstandUpdateNotificationScheduler timer",
            err: error,
          });
        });
      },
      15 * 60 * 1000,
    );
    this.timer.unref?.();
    void this.run().catch((error: unknown) => {
      log.error({
        message:
          "Unhandled error in UpstandUpdateNotificationScheduler initial run",
        err: error,
      });
    });
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async run(): Promise<void> {
    const scope = getServiceProvider().createScope();
    try {
      const status = await scope.resolve(GetUpdateStatusUseCaseToken).execute();
      if (!status.updateAvailable) return;
      await scope.resolve(PublishNotificationUseCaseToken).execute({
        event: "upstand_update_available",
        idempotencyKey: `upstand-update-available:${status.latestVersion}`,
        title: `Upstand ${status.latestVersion} is available`,
        message: `A new Upstand version is ready to install. The current version is ${status.currentVersion}.`,
        metadata: {
          currentVersion: status.currentVersion,
          latestVersion: status.latestVersion,
          channel: status.channel,
        },
      });
    } catch (error: unknown) {
      log.warn({
        message: "Upstand update availability check failed",
        err: error instanceof Error ? error.message : error,
      });
    } finally {
      await scope.dispose();
    }
  }
}

export class AutoscalingRuntime {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly lastScaledAt = new Map<string, number>();

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const scope = getServiceProvider().createScope();
    try {
      const decisions = await new AutoscalingService(
        scope.resolve(UnitOfWorkToken),
        scope.resolve(DockerServiceToken),
        this.lastScaledAt,
        scope.resolve(CaddyServiceToken),
      ).reconcileAll();
      for (const decision of decisions)
        log.info({
          message: "Autoscaling changed resource replicas",
          ...decision,
        });
    } catch (error: unknown) {
      log.warn({
        message: "Autoscaling reconciliation failed",
        err: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.running = false;
      await scope.dispose();
    }
  }

  start(): void {
    this.timer = setInterval(() => {
      this.runOnce().catch((error: unknown) => {
        log.error({
          message: "Unhandled error in AutoscalingRuntime timer",
          err: error,
        });
      });
    }, 30_000);
    this.timer.unref?.();
    void this.runOnce().catch((error: unknown) => {
      log.error({
        message: "Unhandled error in AutoscalingRuntime initial run",
        err: error,
      });
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

export class StaleDeploymentScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.run().catch((error: unknown) => {
        log.error({
          message: "Unhandled error in StaleDeploymentScheduler timer",
          err: error,
        });
      });
    }, 60_000);
    this.timer.unref?.();
    void this.run().catch((error: unknown) => {
      log.error({
        message: "Unhandled error in StaleDeploymentScheduler initial run",
        err: error,
      });
    });
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const scope = getServiceProvider().createScope();
    try {
      const result = await scope
        .resolve(ReconcileStaleDeploymentsUseCaseToken)
        .execute();
      if (result.markedStale > 0) {
        log.warn({
          message: "Marked stale deployment executions",
          ...result,
        });
      }
    } catch (error: unknown) {
      log.warn({
        message: "Stale deployment reconciliation failed",
        err: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.running = false;
      await scope.dispose();
    }
  }
}

export class SchedulerManager {
  private secretRotationTimer: ReturnType<typeof setInterval> | null = null;
  private readonly scheduledDockerCleanup = new ScheduledDockerCleanup();
  private readonly upstandUpdateNotifications =
    new UpstandUpdateNotificationScheduler();
  private readonly autoscalingRuntime = new AutoscalingRuntime();
  private readonly staleDeploymentScheduler = new StaleDeploymentScheduler();
  private accessLogCleanupScheduler: AccessLogCleanupScheduler | null = null;

  async start(): Promise<void> {
    log.info({ message: "Starting standalone cron schedulers..." });

    const backupScheduler = getServiceProvider().resolve(BackupSchedulerToken);
    const generalScheduler = getServiceProvider().resolve(
      GeneralSchedulerToken,
    );

    this.accessLogCleanupScheduler = new AccessLogCleanupScheduler(
      async () => {
        const scope = getServiceProvider().createScope();
        try {
          const settings = await scope
            .resolve(UnitOfWorkToken)
            .webServerSettingsRepository.findGlobal();
          return {
            enabled: settings?.accessLogsEnabled ?? false,
            cronExpression: settings?.accessLogCleanupCron ?? "0 3 * * *",
          };
        } finally {
          await scope.dispose();
        }
      },
      async () => {
        const scope = getServiceProvider().createScope();
        try {
          await scope.resolve(CaddyServiceToken).cleanupAccessLogs();
        } finally {
          await scope.dispose();
        }
      },
    );

    await backupScheduler.start();
    await generalScheduler.start();
    await this.accessLogCleanupScheduler.start();
    this.autoscalingRuntime.start();
    this.staleDeploymentScheduler.start();
    this.scheduledDockerCleanup.start();
    this.upstandUpdateNotifications.start();

    this.secretRotationTimer = setInterval(() => {
      const scope = getServiceProvider().createScope();
      void scope
        .resolve(RunDueSecretRotationsUseCaseToken)
        .execute()
        .catch((error: unknown) => {
          log.warn({
            message: "Secret rotation reconciliation failed",
            err: error,
          });
        })
        .finally(() => scope.dispose());
    }, 60_000);
    this.secretRotationTimer.unref?.();

    log.info({ message: "Standalone cron schedulers started successfully ⏱️" });
  }

  async stop(): Promise<void> {
    log.info({ message: "Stopping standalone cron schedulers..." });

    const backupScheduler = getServiceProvider().resolve(BackupSchedulerToken);
    const generalScheduler = getServiceProvider().resolve(
      GeneralSchedulerToken,
    );

    this.scheduledDockerCleanup.stop();
    this.upstandUpdateNotifications.stop();
    this.autoscalingRuntime.stop();
    this.staleDeploymentScheduler.stop();
    if (this.secretRotationTimer) {
      clearInterval(this.secretRotationTimer);
      this.secretRotationTimer = null;
    }

    await Promise.allSettled([
      backupScheduler.stop(),
      generalScheduler.stop(),
      this.accessLogCleanupScheduler?.stop(),
    ]);

    log.info({ message: "Standalone cron schedulers stopped" });
  }
}
