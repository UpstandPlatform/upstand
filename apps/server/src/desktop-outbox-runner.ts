import type { ServiceResolver } from "@circulo-ai/di";
import { env } from "@upstand/env/server";
import {
  clearLocalDeploymentCancellation,
  DeploymentWorker,
  type DeployOutboxPayload,
  deploymentCancellationKey,
  ExecuteWorkloadMigrationUseCase,
  isLocalDeploymentCancellationRequested,
  OUTBOX_COMMAND_TYPES,
} from "@upstand/usecases";
import {
  CaddyServiceToken,
  DeliverNotificationUseCaseToken,
  DockerDeploymentToken,
  ExecuteBackupRunUseCaseToken,
  ExternalSecretProviderToken,
  PublishNotificationUseCaseToken,
  UnitOfWorkToken,
  WorkloadMigrationPortToken,
} from "@upstand/usecases/tokens";
import { log } from "evlog";
import { getServiceProvider } from "./di";

const POLL_INTERVAL_MS = 500;
const OUTBOX_LEASE_MS = 60_000;
/**
 * Desktop has no Redis, so backup, notification, and migration commands cannot
 * reach the BullMQ workers the self-hosted and cloud schedulers run. They are
 * drained here instead, on a slower cadence than deployments because they are
 * short-lived control operations rather than build pipelines.
 */
const AUXILIARY_POLL_EVERY = 4;
const AUXILIARY_CONCURRENCY = 2;
const AUXILIARY_RETRY_DELAY_MS = 30_000;

function stringField(value: unknown, field: string): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "string" && candidate ? candidate : null;
}

/** The subset of the DI scope the non-deployment outbox commands resolve. */
export type DesktopOutboxCommandScope = Pick<ServiceResolver, "resolve">;

/**
 * Dispatch a non-deployment outbox command to the use case that owns it.
 * Exported so the desktop command surface can be verified without starting the
 * polling runtime.
 */
export async function executeDesktopOutboxCommand(
  scope: DesktopOutboxCommandScope,
  type: string,
  payload: unknown,
): Promise<void> {
  switch (type) {
    case OUTBOX_COMMAND_TYPES.notificationDelivery: {
      const deliveryId = stringField(payload, "deliveryId");
      if (!deliveryId) {
        throw new Error("Notification outbox payload is missing deliveryId");
      }
      await scope.resolve(DeliverNotificationUseCaseToken).execute(deliveryId);
      return;
    }
    case OUTBOX_COMMAND_TYPES.backupRun: {
      const runId = stringField(payload, "runId");
      if (!runId) {
        throw new Error("Backup outbox payload is missing runId");
      }
      // Desktop runs a single control-plane process, so the database execution
      // claim inside the use case is the only exclusion needed; the Redis
      // schedule lock used by the scheduler has no counterpart here.
      await scope.resolve(ExecuteBackupRunUseCaseToken).execute(runId);
      return;
    }
    case OUTBOX_COMMAND_TYPES.migrate: {
      const migrationId = stringField(payload, "migrationId");
      if (!migrationId) {
        throw new Error("Migration outbox payload is missing migrationId");
      }
      await new ExecuteWorkloadMigrationUseCase(
        scope.resolve(UnitOfWorkToken),
        scope.resolve(WorkloadMigrationPortToken),
      ).execute(migrationId);
      return;
    }
    default:
      throw new Error(`Unsupported desktop outbox command type '${type}'`);
  }
}

function deploymentPayload(value: unknown): DeployOutboxPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<DeployOutboxPayload>;
  if (
    typeof payload.resourceId !== "string" ||
    typeof payload.deploymentId !== "string" ||
    typeof payload.serverId !== "string"
  ) {
    return null;
  }
  return payload as DeployOutboxPayload;
}

export class DesktopOutboxRunner {
  private readonly worker = new DeploymentWorker("local", {
    getBuildSettings: () => this.getBuildSettings(),
    createScope: async () => {
      const scope = getServiceProvider().createScope();
      return {
        uow: scope.resolve(UnitOfWorkToken),
        dockerService: scope.resolve(DockerDeploymentToken),
        caddyService: scope.resolve(CaddyServiceToken),
        publisher: scope.resolve(PublishNotificationUseCaseToken),
        externalSecretProvider: scope.resolve(ExternalSecretProviderToken),
        dispose: () => scope.dispose(),
      };
    },
  });
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = 0;
  private auxiliaryInFlight = 0;
  private pollCount = 0;
  private stopping = false;

  async start(): Promise<void> {
    if (env.UPSTAND_PLATFORM !== "desktop") return;
    this.stopping = false;
    await this.poll();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.inFlight > 0 || this.auxiliaryInFlight > 0) {
      await Bun.sleep(100);
    }
  }

  private async getBuildSettings(): Promise<{ concurrency: number } | null> {
    const scope = getServiceProvider().createScope();
    try {
      const uow = scope.resolve(UnitOfWorkToken);
      const settings =
        await uow.serverBuildSettingsRepository.findById("local");
      return settings ?? { concurrency: 2 };
    } finally {
      await scope.dispose();
    }
  }

  private async poll(): Promise<void> {
    if (this.stopping) return;
    try {
      await this.pollDeployments();
      this.pollCount += 1;
      if (this.pollCount % AUXILIARY_POLL_EVERY === 0) {
        await this.pollAuxiliaryCommands();
      }
    } catch (error) {
      log.error({
        message: "Desktop outbox runner poll failed",
        err: error instanceof Error ? error.message : error,
      });
    } finally {
      if (!this.stopping) {
        this.timer = setTimeout(() => void this.poll(), POLL_INTERVAL_MS);
        this.timer.unref?.();
      }
    }
  }

  private async pollDeployments(): Promise<void> {
    const settings = await this.getBuildSettings();
    const concurrency = Math.max(1, Math.min(100, settings?.concurrency ?? 2));
    const capacity = concurrency - this.inFlight;
    if (capacity <= 0) return;

    const scope = getServiceProvider().createScope();
    try {
      const messages = await scope
        .resolve(UnitOfWorkToken)
        .outboxRepository.claimBatch(
          new Date(),
          OUTBOX_LEASE_MS,
          capacity,
          OUTBOX_COMMAND_TYPES.deploy,
        );
      for (const message of messages) {
        const payload = deploymentPayload(message.payload);
        if (!payload) {
          await scope
            .resolve(UnitOfWorkToken)
            .outboxRepository.markFailed(
              message.id,
              new Date(),
              "Desktop deployment outbox payload is invalid",
              60_000,
              message.claimedAt,
            );
          continue;
        }
        // A cancellation requested between queueing and this claim must not
        // start a build the operator already stopped.
        if (
          isLocalDeploymentCancellationRequested(
            deploymentCancellationKey(payload.deploymentId),
          )
        ) {
          clearLocalDeploymentCancellation(
            deploymentCancellationKey(payload.deploymentId),
          );
          await scope
            .resolve(UnitOfWorkToken)
            .outboxRepository.markPublished(
              message.id,
              new Date(),
              message.claimedAt,
            );
          continue;
        }
        this.inFlight += 1;
        void this.processMessage(message.id, message.claimedAt, payload);
      }
    } finally {
      await scope.dispose();
    }
  }

  private async pollAuxiliaryCommands(): Promise<void> {
    const capacity = AUXILIARY_CONCURRENCY - this.auxiliaryInFlight;
    if (capacity <= 0) return;

    const scope = getServiceProvider().createScope();
    try {
      const outboxRepository = scope.resolve(UnitOfWorkToken).outboxRepository;
      for (const type of [
        OUTBOX_COMMAND_TYPES.notificationDelivery,
        OUTBOX_COMMAND_TYPES.backupRun,
        OUTBOX_COMMAND_TYPES.migrate,
      ]) {
        const remaining = AUXILIARY_CONCURRENCY - this.auxiliaryInFlight;
        if (remaining <= 0) return;
        const messages = await outboxRepository.claimBatch(
          new Date(),
          OUTBOX_LEASE_MS,
          remaining,
          type,
        );
        for (const message of messages) {
          this.auxiliaryInFlight += 1;
          void this.processAuxiliaryMessage(
            message.id,
            message.type,
            message.claimedAt,
            message.payload,
          );
        }
      }
    } finally {
      await scope.dispose();
    }
  }

  private async processMessage(
    id: string,
    claimedAt: Date | null | undefined,
    payload: DeployOutboxPayload,
  ): Promise<void> {
    const scope = getServiceProvider().createScope();
    try {
      await this.worker.processInline(payload);
      await scope
        .resolve(UnitOfWorkToken)
        .outboxRepository.markPublished(id, new Date(), claimedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await scope
        .resolve(UnitOfWorkToken)
        .outboxRepository.markFailed(
          id,
          new Date(),
          message,
          Math.min(
            300_000,
            2_000 * 2 ** Math.max(0, (payload.maxAttempts ?? 1) - 1),
          ),
          claimedAt,
        );
      log.error({
        message: "Desktop deployment execution failed",
        deploymentId: payload.deploymentId,
        resourceId: payload.resourceId,
        err: message,
      });
    } finally {
      await scope.dispose();
      this.inFlight -= 1;
    }
  }

  private async processAuxiliaryMessage(
    id: string,
    type: string,
    claimedAt: Date | null | undefined,
    payload: unknown,
  ): Promise<void> {
    const scope = getServiceProvider().createScope();
    try {
      await executeDesktopOutboxCommand(scope, type, payload);
      await scope
        .resolve(UnitOfWorkToken)
        .outboxRepository.markPublished(id, new Date(), claimedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await scope
        .resolve(UnitOfWorkToken)
        .outboxRepository.markFailed(
          id,
          new Date(),
          message,
          AUXILIARY_RETRY_DELAY_MS,
          claimedAt,
        );
      log.error({
        message: "Desktop outbox command failed",
        outboxType: type,
        err: message,
      });
    } finally {
      await scope.dispose();
      this.auxiliaryInFlight -= 1;
    }
  }
}
