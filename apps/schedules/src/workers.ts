import { env } from "@upstand/env/server";
import {
  BullMqOutboxJobPublisher,
  getDockerInstance,
} from "@upstand/infrastructure";
import {
  BackupRunWorker,
  DeploymentWorker,
  NotificationDeliveryWorker,
  OutboxPublisher,
} from "@upstand/usecases";
import {
  releaseBackupRunLock,
  renewBackupRunLock,
} from "@upstand/usecases/backup/backup-run-lock";
import {
  CaddyServiceToken,
  DeliverNotificationUseCaseToken,
  DockerServiceToken,
  ExecuteBackupRunUseCaseToken,
  PublishNotificationUseCaseToken,
  UnitOfWorkToken,
} from "@upstand/usecases/tokens";
import { log } from "evlog";
import { getServiceProvider } from "./di";

const PUBLISH_INTERVAL_MS = 1_000;
const RETENTION_INTERVAL_MS = 60 * 60_000;
const PUBLISHED_RETENTION_MS = 30 * 24 * 60 * 60_000;

export class OutboxRuntime {
  private started = false;
  private readonly jobPublisher = new BullMqOutboxJobPublisher();
  private publishTimer: ReturnType<typeof setInterval> | null = null;
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private publishInFlight: Promise<void> | null = null;

  async start(): Promise<void> {
    await this.publishBatch();
    this.started = true;
    this.startMaintenance();
  }

  isReady(): boolean {
    return this.started;
  }

  private startMaintenance(): void {
    if (this.publishTimer) return;
    this.publishTimer = setInterval(() => {
      this.publishBatch().catch((error: unknown) => {
        log.error({
          message: "Unhandled error in OutboxRuntime publishBatch timer",
          err: error,
        });
      });
    }, PUBLISH_INTERVAL_MS);
    this.publishTimer.unref?.();
    this.retentionTimer = setInterval(() => {
      this.prunePublished().catch((error: unknown) => {
        log.warn({
          message: "Unhandled error in OutboxRuntime prunePublished timer",
          err: error,
        });
      });
    }, RETENTION_INTERVAL_MS);
    this.retentionTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.publishTimer) clearInterval(this.publishTimer);
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.publishTimer = null;
    this.retentionTimer = null;
    this.started = false;
    if (this.publishInFlight) await this.publishInFlight;
    await this.jobPublisher.close();
  }

  private async publishBatch(): Promise<void> {
    if (this.publishInFlight) return this.publishInFlight;

    this.publishInFlight = (async () => {
      const scope = getServiceProvider().createScope();
      try {
        const publisher = new OutboxPublisher(
          scope.resolve(UnitOfWorkToken),
          this.jobPublisher,
        );
        const result = await publisher.publishBatch();
        if (result.claimed > 0) {
          log.info({ message: "Transactional outbox batch processed", result });
          if (result.deadLettered > 0) {
            log.error({
              message: "Transactional outbox messages moved to dead letter",
              deadLettered: result.deadLettered,
            });
          }
        }
      } catch (error: unknown) {
        log.error({
          message: "Failed to process transactional outbox",
          err: error,
        });
      } finally {
        await scope.dispose();
      }
    })();

    try {
      await this.publishInFlight;
    } finally {
      this.publishInFlight = null;
    }
  }

  private async prunePublished(): Promise<void> {
    const scope = getServiceProvider().createScope();
    try {
      const uow = scope.resolve(UnitOfWorkToken);
      const deleted = await uow.outboxRepository.prunePublished(
        new Date(Date.now() - PUBLISHED_RETENTION_MS),
      );
      if (deleted > 0) {
        log.info({
          message: "Published transactional outbox messages pruned",
          deleted,
        });
      }
    } catch (error: unknown) {
      log.warn({
        message: "Failed to prune published transactional outbox messages",
        err: error,
      });
    } finally {
      await scope.dispose();
    }
  }
}

export class DeploymentRuntime {
  private readonly workers = new Map<string, DeploymentWorker>();
  private refreshInFlight: Promise<void> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  isReady(): boolean {
    return (
      this.workers.size > 0 &&
      [...this.workers.values()].every((worker) => worker.isReady())
    );
  }

  async start(): Promise<void> {
    await this.refreshWorkers();
    this.startMaintenance();
  }

  private startMaintenance(): void {
    this.refreshTimer = setInterval(
      () =>
        void this.refreshWorkers().catch((error: unknown) => {
          log.error({
            message: "Failed to refresh deployment queue workers",
            err: error,
          });
        }),
      60_000,
    );
    this.refreshTimer.unref?.();
  }

  async refreshWorkers(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      const serverIds = await this.discoverServerIds();
      for (const serverId of serverIds) {
        if (this.workers.has(serverId)) continue;
        const worker = new DeploymentWorker(serverId, {
          getBuildSettings: async () => {
            const scope = getServiceProvider().createScope();
            try {
              const uow = scope.resolve(UnitOfWorkToken);
              const settings =
                await uow.serverBuildSettingsRepository.findById(serverId);
              if (settings) return settings;

              const concurrency = serverId === "local" ? 2 : 1;
              try {
                await uow.serverBuildSettingsRepository.create({
                  id: serverId,
                  hostname:
                    serverId === "local"
                      ? "Upstand Server"
                      : `Swarm Node ${serverId}`,
                  ip: "127.0.0.1",
                  concurrency,
                });
              } catch (createErr: unknown) {
                log.warn({
                  message: "Could not create server build settings record",
                  serverId,
                  err: createErr,
                });
              }
              return { concurrency };
            } finally {
              await scope.dispose();
            }
          },
          createScope: async () => {
            const scope = getServiceProvider().createScope();
            return {
              uow: scope.resolve(UnitOfWorkToken),
              dockerService: scope.resolve(DockerServiceToken),
              caddyService: scope.resolve(CaddyServiceToken),
              publisher: scope.resolve(PublishNotificationUseCaseToken),
              dispose: () => scope.dispose(),
            };
          },
        });
        await worker.start();
        this.workers.set(serverId, worker);
        log.info({
          message: "Deployment queue worker started",
          serverId,
          queueConsumers: this.workers.size,
        });
      }
    })();

    try {
      await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  async stop(): Promise<PromiseSettledResult<void>[]> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;

    return Promise.allSettled(
      [...this.workers.values()].map((worker) => worker.stop()),
    );
  }

  private async discoverServerIds(): Promise<string[]> {
    if (env.SERVER_ID) return [env.SERVER_ID];

    const serverIds = new Set<string>();
    const scope = getServiceProvider().createScope();
    try {
      const uow = scope.resolve(UnitOfWorkToken);
      const servers = await uow.serverRepository.findMany();
      const serverById = new Map(servers.map((server) => [server.id, server]));
      const settings = await uow.serverBuildSettingsRepository.findMany();
      for (const setting of settings) {
        if (serverById.get(setting.id)?.serverType !== "database") {
          serverIds.add(setting.id);
        }
      }

      for (const server of servers) {
        if (server.status === "ready" && server.serverType !== "database") {
          serverIds.add(server.id);
        }
      }
    } finally {
      await scope.dispose();
    }

    const docker = getDockerInstance();
    try {
      const info = await docker.info();
      if (info.Swarm?.LocalNodeState === "active") {
        const nodes = await docker.listNodes();
        for (const node of nodes) {
          if (node.ID) serverIds.add(node.ID);
        }
      }
    } catch (error: unknown) {
      log.warn({
        message: "Unable to discover Docker nodes for deployment workers",
        err: error,
      });
    }

    if (serverIds.size === 0) serverIds.add("local");
    return [...serverIds];
  }
}

export function createBackupRunHandler() {
  return async (job: {
    data: { runId?: string };
    opts: { attempts?: number };
    attemptsMade: number;
  }): Promise<void> => {
    const runId = job.data.runId;
    if (!runId) throw new Error("Backup job is missing runId");

    const scope = getServiceProvider().createScope();
    const uow = scope.resolve(UnitOfWorkToken);
    let scheduleId: string | null = null;
    let renewalTimer: ReturnType<typeof setInterval> | null = null;

    try {
      const run = await uow.backupRunRepository.findById(runId);
      if (!run) throw new Error("Backup run record not found");
      scheduleId = run.scheduleId;
      if (run.status === "succeeded") return;

      const claimedRun = await uow.backupRunRepository.claimForExecution(
        runId,
        new Date(),
      );
      if (!claimedRun) return;

      renewalTimer = setInterval(
        () =>
          void renewBackupRunLock(claimedRun.scheduleId, runId)
            .then((renewed: boolean) => {
              if (!renewed) {
                log.error({
                  message: "Backup run no longer owns its schedule lock",
                  scheduleId: claimedRun.scheduleId,
                  runId,
                });
              }
            })
            .catch((error: unknown) => {
              log.warn({
                message: "Unable to renew backup run lock",
                scheduleId: claimedRun.scheduleId,
                runId,
                err: error,
              });
            }),
        60_000,
      );
      renewalTimer.unref?.();

      const execute = scope.resolve(ExecuteBackupRunUseCaseToken);
      await execute.execute(runId, claimedRun);
      await releaseBackupRunLock(claimedRun.scheduleId, runId);
    } catch (error: unknown) {
      const attempts = job.opts.attempts ?? 1;
      const finalAttempt = job.attemptsMade + 1 >= attempts;
      if (finalAttempt && scheduleId) {
        await releaseBackupRunLock(scheduleId, runId);
      }
      throw error;
    } finally {
      if (renewalTimer) clearInterval(renewalTimer);
      await scope.dispose();
    }
  };
}

export class WorkerManager {
  private notificationWorker: NotificationDeliveryWorker | null = null;
  private backupWorker: BackupRunWorker | null = null;
  private deploymentRuntime: DeploymentRuntime | null = null;
  private outboxRuntime: OutboxRuntime | null = null;

  async start(): Promise<void> {
    log.info({ message: "Starting standalone queue workers & runtimes..." });

    this.notificationWorker = new NotificationDeliveryWorker(
      async (deliveryId: string) => {
        const scope = getServiceProvider().createScope();
        try {
          await scope
            .resolve(DeliverNotificationUseCaseToken)
            .execute(deliveryId);
        } finally {
          await scope.dispose();
        }
      },
    );

    this.backupWorker = new BackupRunWorker(createBackupRunHandler());
    this.deploymentRuntime = new DeploymentRuntime();
    this.outboxRuntime = new OutboxRuntime();

    await this.notificationWorker.start();
    await this.backupWorker.start();
    await this.deploymentRuntime.start();
    await this.outboxRuntime.start();

    log.info({
      message: "Standalone queue workers & runtimes started successfully 👷‍♂️",
    });
  }

  isReady(): boolean {
    return (
      (this.notificationWorker?.isReady() ?? false) &&
      (this.backupWorker?.isReady() ?? false) &&
      (this.deploymentRuntime?.isReady() ?? false) &&
      (this.outboxRuntime?.isReady() ?? false)
    );
  }

  async stop(): Promise<void> {
    log.info({ message: "Stopping standalone queue workers & runtimes..." });

    await Promise.allSettled([
      this.notificationWorker?.stop(),
      this.backupWorker?.stop(),
      this.deploymentRuntime?.stop(),
      this.outboxRuntime?.stop(),
    ]);

    this.notificationWorker = null;
    this.backupWorker = null;
    this.deploymentRuntime = null;
    this.outboxRuntime = null;

    log.info({ message: "Standalone queue workers stopped" });
  }
}
