import { randomUUID } from "node:crypto";
import { BACKUP_RUN_EXECUTION_LEASE_MS } from "@upstand/domain";
import { env } from "@upstand/env/server";
import {
  BullMqOutboxJobPublisher,
  DockerWorkloadMigrationPort,
} from "@upstand/infrastructure";
import { closeRedis, createRedis, pingRedis, redis } from "@upstand/redis";
import {
  BackupRunWorker,
  DeploymentWorker,
  ExecuteWorkloadMigrationUseCase,
  NotificationDeliveryWorker,
  OUTBOX_COMMAND_TYPES,
  OutboxPublisher,
  WORKLOAD_MIGRATION_QUEUE,
  withJobTelemetry,
} from "@upstand/usecases";
import {
  ensureBackupRunLock,
  releaseBackupRunLock,
  renewBackupRunLock,
} from "@upstand/usecases/backup/backup-run-lock";
import {
  CaddyServiceToken,
  DeliverNotificationUseCaseToken,
  DockerDeploymentToken,
  DockerInventoryReaderToken,
  DockerWorkloadMigrationPortToken,
  ExecuteBackupRunUseCaseToken,
  PublishNotificationUseCaseToken,
  UnitOfWorkToken,
} from "@upstand/usecases/tokens";
import { Worker as BullMqWorker, Queue } from "bullmq";
import { log } from "evlog";
import { getServiceProvider } from "./di";

const PUBLISH_INTERVAL_MS = 1_000;
const RETENTION_INTERVAL_MS = 60 * 60_000;
const PUBLISHED_RETENTION_MS = 30 * 24 * 60 * 60_000;
const SCHEDULE_LOG_RETENTION_MS = 30 * 24 * 60 * 60_000;
const STALE_BACKUP_RECOVERY_INTERVAL_MS = 60_000;
const AUDIT_LOG_PRUNE_BATCH_SIZE = 1_000;

export type SchedulesRole = "all" | "orchestrator" | "deployment-worker";

export function shouldRecoverWorkerManager(input: {
  started: boolean;
  stopping: boolean;
  shutdownRequested: boolean;
  recoveryInFlight: boolean;
  workersReady: boolean;
  redisReady: boolean;
}): boolean {
  return (
    input.started &&
    !input.stopping &&
    !input.shutdownRequested &&
    !input.recoveryInFlight &&
    !input.workersReady &&
    input.redisReady
  );
}

export class OutboxRuntime {
  private started = false;
  private readonly jobPublisher = new BullMqOutboxJobPublisher();
  private publishTimer: ReturnType<typeof setInterval> | null = null;
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private staleBackupRecoveryTimer: ReturnType<typeof setInterval> | null =
    null;
  private publishInFlight: Promise<void> | null = null;

  async start(): Promise<void> {
    await this.recoverStaleBackupRuns();
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
    this.staleBackupRecoveryTimer = setInterval(() => {
      this.recoverStaleBackupRuns().catch((error: unknown) => {
        log.warn({
          message: "Failed to recover stale backup runs",
          err: error,
        });
      });
    }, STALE_BACKUP_RECOVERY_INTERVAL_MS);
    this.staleBackupRecoveryTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.publishTimer) clearInterval(this.publishTimer);
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    if (this.staleBackupRecoveryTimer)
      clearInterval(this.staleBackupRecoveryTimer);
    this.publishTimer = null;
    this.retentionTimer = null;
    this.staleBackupRecoveryTimer = null;
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
      const deletedScheduleLogs =
        await uow.scheduleLogRepository.deleteOlderThan?.(
          new Date(Date.now() - SCHEDULE_LOG_RETENTION_MS),
        );
      const deletedAuditLogs = await uow.auditLogRepository.deleteOlderThan?.(
        new Date(
          Date.now() - env.UPSTAND_AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60_000,
        ),
        AUDIT_LOG_PRUNE_BATCH_SIZE,
      );
      if (deleted > 0) {
        log.info({
          message: "Published transactional outbox messages pruned",
          deleted,
        });
      }
      if ((deletedScheduleLogs ?? 0) > 0) {
        log.info({
          message: "Old schedule logs pruned",
          deleted: deletedScheduleLogs,
        });
      }
      if ((deletedAuditLogs ?? 0) > 0) {
        log.info({
          message: "Old audit logs pruned",
          deleted: deletedAuditLogs,
          retentionDays: env.UPSTAND_AUDIT_LOG_RETENTION_DAYS,
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

  private async recoverStaleBackupRuns(): Promise<void> {
    const scope = getServiceProvider().createScope();
    try {
      const uow = scope.resolve(UnitOfWorkToken);
      const now = new Date();
      const staleBefore = new Date(
        now.getTime() - BACKUP_RUN_EXECUTION_LEASE_MS,
      );
      const runningRuns = await uow.backupRunRepository.findByStatus(
        "running",
        100,
      );

      for (const candidate of runningRuns) {
        if (candidate.updatedAt >= staleBefore) continue;
        const recovered = await uow.transaction(async (tx) => {
          const run = await tx.backupRunRepository.requeueStaleForRecovery?.(
            candidate.id,
            now,
          );
          if (!run) return null;
          await tx.outboxRepository.create({
            id: randomUUID(),
            type: OUTBOX_COMMAND_TYPES.backupRun,
            payload: { runId: run.id },
            aggregateType: "backup_run",
            aggregateId: run.id,
            organizationId: run.organizationId,
            idempotencyKey: `backup-run-recovery:${run.id}:${run.updatedAt.getTime()}`,
          });
          return run;
        });
        if (recovered) {
          log.warn({
            message: "Requeued stale backup run after worker lease expiry",
            scheduleId: recovered.scheduleId,
            runId: recovered.id,
          });
        }
      }
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
      const desiredServerIds = new Set(serverIds);
      const staleWorkers = [...this.workers.entries()].filter(
        ([serverId]) => !desiredServerIds.has(serverId),
      );
      await Promise.allSettled(
        staleWorkers.map(async ([serverId, worker]) => {
          this.workers.delete(serverId);
          try {
            await worker.stop();
            log.info({
              message: "Deployment queue worker stopped for removed target",
              serverId,
            });
          } catch (error: unknown) {
            log.error({
              message:
                "Failed to stop deployment queue worker for removed target",
              serverId,
              err: error,
            });
          }
        }),
      );
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
              dockerService: scope.resolve(DockerDeploymentToken),
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

    const workers = [...this.workers.values()];
    this.workers.clear();

    return Promise.allSettled(workers.map((worker) => worker.stop()));
  }

  private async discoverServerIds(): Promise<string[]> {
    if (env.SERVER_ID) return [env.SERVER_ID];

    const serverIds = new Set<string>();
    const scope = getServiceProvider().createScope();
    try {
      const uow = scope.resolve(UnitOfWorkToken);
      const servers = uow.serverRepository.findDeploymentDiscovery
        ? await uow.serverRepository.findDeploymentDiscovery()
        : await uow.serverRepository.findMany();
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

      try {
        const nodes = await scope
          .resolve(DockerInventoryReaderToken)
          .listSwarmNodes({ kind: "local", name: "local" });
        for (const node of nodes) {
          if (node.id) serverIds.add(node.id);
        }
      } catch (error: unknown) {
        log.warn({
          message: "Unable to discover Docker nodes for deployment workers",
          err: error,
        });
      }
    } finally {
      await scope.dispose();
    }

    if (serverIds.size === 0) serverIds.add("local");
    return [...serverIds];
  }
}

export class WorkloadMigrationRuntime {
  private readonly connection = createRedis({
    maxRetriesPerRequest: null,
    loggerName: "workload-migration-worker",
  });
  private readonly queue = new Queue(WORKLOAD_MIGRATION_QUEUE, {
    connection: this.connection as never,
  });
  private readonly worker = new BullMqWorker<{
    migrationId?: string;
    correlationId?: string;
  }>(
    WORKLOAD_MIGRATION_QUEUE,
    async (job) => {
      const migrationId = job.data.migrationId;
      if (!migrationId) throw new Error("Migration job is missing migrationId");
      await withJobTelemetry(
        {
          operation: "workload-migration.execute",
          queue: WORKLOAD_MIGRATION_QUEUE,
          jobId: job.id,
          correlationId: job.data.correlationId,
          attempt: job.attemptsMade + 1,
          fields: { migration: { id: migrationId } },
        },
        async () => {
          const scope = getServiceProvider().createScope();
          try {
            const uow = scope.resolve(UnitOfWorkToken);
            const port = new DockerWorkloadMigrationPort(
              uow,
              scope.resolve(DockerWorkloadMigrationPortToken),
              scope.resolve(CaddyServiceToken),
            );
            await new ExecuteWorkloadMigrationUseCase(uow, port).execute(
              migrationId,
              String(job.id ?? randomUUID()),
            );
          } finally {
            await scope.dispose();
          }
        },
      );
    },
    {
      connection: this.connection as never,
      concurrency: 1,
      autorun: false,
      lockDuration: 5 * 60_000,
      stalledInterval: 30_000,
      maxStalledCount: 2,
    },
  );
  private ready = false;

  async start(): Promise<void> {
    await this.enqueueResumable();
    this.worker.run().catch((error: unknown) => {
      this.ready = false;
      log.error({
        message: "Workload migration worker stopped unexpectedly",
        err: error,
      });
    });
    await this.worker.waitUntilReady();
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready && this.worker.isRunning();
  }

  async stop(): Promise<void> {
    this.ready = false;
    await Promise.allSettled([this.worker.close(), this.queue.close()]);
    await closeRedis(this.connection);
  }

  private async enqueueResumable(): Promise<void> {
    const scope = getServiceProvider().createScope();
    try {
      const migrations = await scope
        .resolve(UnitOfWorkToken)
        .workloadMigrationRepository.findResumable(100);
      for (const migration of migrations) {
        await this.queue.add(
          "resume",
          { migrationId: migration.id },
          {
            jobId: `migration-recovery-${migration.id}-${migration.updatedAt.getTime()}`,
            attempts: 8,
            backoff: { type: "exponential", delay: 5_000 },
            removeOnComplete: 1_000,
            removeOnFail: 1_000,
          },
        );
      }
    } finally {
      await scope.dispose();
    }
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
    let ownsExecution = false;

    try {
      const run = await uow.backupRunRepository.findById(runId);
      if (!run) throw new Error("Backup run record not found");
      scheduleId = run.scheduleId;
      if (run.status === "succeeded") return;

      const claimedRun = await uow.backupRunRepository.claimForExecution(
        runId,
        new Date(),
      );
      if (!claimedRun) {
        // A duplicate delivery may arrive while another worker is still
        // executing this run. Throw so BullMQ retries after the execution
        // lease has had a chance to become reclaimable; returning here would
        // acknowledge the job and could strand a crashed run forever.
        throw new Error("Backup run is already being processed");
      }
      ownsExecution = true;
      if (!(await ensureBackupRunLock(claimedRun.scheduleId, runId))) {
        throw new Error("Backup run schedule lock is owned by another run");
      }

      renewalTimer = setInterval(() => {
        void Promise.all([
          renewBackupRunLock(claimedRun.scheduleId, runId).then(
            (renewed: boolean) => {
              if (!renewed) {
                log.error({
                  message: "Backup run no longer owns its schedule lock",
                  scheduleId: claimedRun.scheduleId,
                  runId,
                });
              }
            },
          ),
          uow.backupRunRepository.heartbeatExecution?.(runId, new Date()),
        ]).catch((error: unknown) => {
          log.warn({
            message: "Unable to renew backup run lease",
            scheduleId: claimedRun.scheduleId,
            runId,
            err: error,
          });
        });
      }, 60_000);
      renewalTimer.unref?.();

      const execute = scope.resolve(ExecuteBackupRunUseCaseToken);
      await execute.execute(runId, claimedRun);
      await releaseBackupRunLock(claimedRun.scheduleId, runId);
    } catch (error: unknown) {
      const attempts = job.opts.attempts ?? 1;
      const finalAttempt = job.attemptsMade + 1 >= attempts;
      if (finalAttempt && scheduleId && ownsExecution) {
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
  private workloadMigrationRuntime: WorkloadMigrationRuntime | null = null;
  private recoveryTimer: ReturnType<typeof setInterval> | null = null;
  private recoveryInFlight: Promise<void> | null = null;
  private started = false;
  private stopping = false;
  private shutdownRequested = false;

  private static readonly RECOVERY_INTERVAL_MS = 5_000;

  constructor(
    private readonly role: SchedulesRole = env.UPSTAND_SCHEDULES_ROLE,
  ) {}

  async start(): Promise<void> {
    if (this.started) return;

    this.shutdownRequested = false;
    this.stopping = false;
    log.info({
      message: "Starting standalone queue workers & runtimes...",
      schedulesRole: this.role,
    });

    if (this.role !== "deployment-worker") {
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
      this.outboxRuntime = new OutboxRuntime();
      this.workloadMigrationRuntime = new WorkloadMigrationRuntime();

      await this.notificationWorker.start();
      await this.backupWorker.start();
      await this.outboxRuntime.start();
      await this.workloadMigrationRuntime.start();
    }

    if (this.role !== "orchestrator") {
      this.deploymentRuntime = new DeploymentRuntime();
      await this.deploymentRuntime.start();
    }

    log.info({
      message: "Standalone queue workers & runtimes started successfully 👷‍♂️",
      schedulesRole: this.role,
    });
    this.started = true;
    this.startRecoveryMonitor();
  }

  isReady(): boolean {
    const readiness: boolean[] = [];
    if (this.role !== "deployment-worker") {
      readiness.push(
        this.notificationWorker?.isReady() ?? false,
        this.backupWorker?.isReady() ?? false,
        this.outboxRuntime?.isReady() ?? false,
        this.workloadMigrationRuntime?.isReady() ?? false,
      );
    }
    if (this.role !== "orchestrator") {
      readiness.push(this.deploymentRuntime?.isReady() ?? false);
    }
    return readiness.length > 0 && readiness.every(Boolean);
  }

  async stop(): Promise<void> {
    this.shutdownRequested = true;
    this.started = false;
    this.stopping = true;
    this.stopRecoveryMonitor();

    await this.stopComponents();
  }

  private startRecoveryMonitor(): void {
    if (this.recoveryTimer || this.shutdownRequested) return;
    this.recoveryTimer = setInterval(
      () => void this.recoverIfNeeded(),
      WorkerManager.RECOVERY_INTERVAL_MS,
    );
    this.recoveryTimer.unref?.();
  }

  private stopRecoveryMonitor(): void {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  private async recoverIfNeeded(): Promise<void> {
    if (
      !this.started ||
      this.stopping ||
      this.shutdownRequested ||
      this.recoveryInFlight ||
      this.isReady()
    ) {
      return;
    }

    const redisReady = await pingRedis(redis);
    if (
      !shouldRecoverWorkerManager({
        started: this.started,
        stopping: this.stopping,
        shutdownRequested: this.shutdownRequested,
        recoveryInFlight: Boolean(this.recoveryInFlight),
        workersReady: this.isReady(),
        redisReady,
      })
    ) {
      return;
    }

    this.recoveryInFlight = (async () => {
      log.warn({
        message:
          "Schedules workers lost readiness; restarting after Redis recovery",
        schedulesRole: this.role,
      });
      this.started = false;
      this.stopping = true;
      this.stopRecoveryMonitor();
      await this.stopComponents();

      if (this.shutdownRequested) return;

      this.stopping = false;
      await this.start();
    })()
      .catch((error: unknown) => {
        log.error({
          message: "Failed to restart schedules workers after Redis recovery",
          err: error,
        });
        if (!this.shutdownRequested) {
          this.stopping = false;
          this.startRecoveryMonitor();
        }
      })
      .finally(() => {
        this.recoveryInFlight = null;
      });

    await this.recoveryInFlight;
  }

  private async stopComponents(): Promise<void> {
    log.info({ message: "Stopping standalone queue workers & runtimes..." });

    await Promise.allSettled([
      this.notificationWorker?.stop(),
      this.backupWorker?.stop(),
      this.deploymentRuntime?.stop(),
      this.outboxRuntime?.stop(),
      this.workloadMigrationRuntime?.stop(),
    ]);

    this.notificationWorker = null;
    this.backupWorker = null;
    this.deploymentRuntime = null;
    this.outboxRuntime = null;
    this.workloadMigrationRuntime = null;

    log.info({ message: "Standalone queue workers stopped" });
  }
}
