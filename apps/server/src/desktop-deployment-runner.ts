import { env } from "@upstand/env/server";
import {
  DeploymentWorker,
  type DeployOutboxPayload,
  OUTBOX_COMMAND_TYPES,
} from "@upstand/usecases";
import {
  CaddyServiceToken,
  DockerDeploymentToken,
  ExternalSecretProviderToken,
  PublishNotificationUseCaseToken,
  UnitOfWorkToken,
} from "@upstand/usecases/tokens";
import { log } from "evlog";
import { getServiceProvider } from "./di";

const POLL_INTERVAL_MS = 500;
const OUTBOX_LEASE_MS = 60_000;

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

export class DesktopDeploymentRunner {
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
    while (this.inFlight > 0) await Bun.sleep(100);
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
      const settings = await this.getBuildSettings();
      const concurrency = Math.max(
        1,
        Math.min(100, settings?.concurrency ?? 2),
      );
      const capacity = concurrency - this.inFlight;
      if (capacity > 0) {
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
            this.inFlight += 1;
            void this.processMessage(message.id, message.claimedAt, payload);
          }
        } finally {
          await scope.dispose();
        }
      }
    } catch (error) {
      log.error({
        message: "Desktop deployment runner poll failed",
        err: error instanceof Error ? error.message : error,
      });
    } finally {
      if (!this.stopping) {
        this.timer = setTimeout(() => void this.poll(), POLL_INTERVAL_MS);
        this.timer.unref?.();
      }
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
}
