import { randomUUID } from "node:crypto";
import {
  assertWorkloadMigrationTransition,
  type IUnitOfWork,
  TERMINAL_WORKLOAD_MIGRATION_STATUSES,
  type WorkloadMigration,
  type WorkloadMigrationCheckpoint,
  type WorkloadMigrationStatus,
} from "@upstand/domain";
import type {
  WorkloadMigrationContext,
  WorkloadMigrationPort,
} from "../ports/workload-migration";

const EXECUTION_LEASE_MS = 5 * 60_000;

export class ExecuteWorkloadMigrationUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly port: WorkloadMigrationPort,
  ) {}

  async execute(
    migrationId: string,
    executionToken: string = randomUUID(),
  ): Promise<WorkloadMigration> {
    const now = new Date();
    const claimed = await this.uow.workloadMigrationRepository.claim(
      migrationId,
      executionToken,
      now,
      new Date(now.getTime() - EXECUTION_LEASE_MS),
    );
    if (!claimed) {
      const existing =
        await this.uow.workloadMigrationRepository.findById(migrationId);
      if (!existing) throw new Error("Workload migration not found");
      if (
        TERMINAL_WORKLOAD_MIGRATION_STATUSES.has(existing.status) ||
        existing.status === "awaiting-confirmation"
      ) {
        return existing;
      }
      throw new Error("Workload migration is owned by another active worker");
    }
    let migration: WorkloadMigration = claimed;

    const resource = await this.uow.resourceRepository.findById(
      migration.resourceId,
    );
    if (!resource) {
      return this.fail(
        migration,
        executionToken,
        "RESOURCE_NOT_FOUND",
        "Resource not found",
      );
    }

    let cutoverStarted = [
      "cutting-over",
      "awaiting-confirmation",
      "rolling-back",
    ].includes(migration.status);

    try {
      while (true) {
        migration =
          (await this.uow.workloadMigrationRepository.findById(migration.id)) ??
          migration;
        if (migration.cancelRequested) {
          return await this.cancel(migration, resource, executionToken);
        }

        const context = this.context(migration, resource, executionToken);
        switch (migration.status) {
          case "queued":
            migration = await this.transition(
              migration,
              executionToken,
              "preflight",
              5,
            );
            break;
          case "preflight": {
            const result = await this.port.preflight(context);
            const failed = result.checks.filter((check) => !check.ok);
            if (failed.length > 0) {
              throw new MigrationStepError(
                "PREFLIGHT_FAILED",
                failed
                  .map((check) => `${check.code}: ${check.message}`)
                  .join("; "),
              );
            }
            migration = await this.transition(
              migration,
              executionToken,
              "transferring",
              20,
              result.checkpoint,
            );
            break;
          }
          case "transferring":
            await this.port.transfer(context);
            migration = await this.transition(
              migration,
              executionToken,
              "shadow-deploying",
              55,
            );
            break;
          case "shadow-deploying":
            await this.port.deployShadow(context);
            migration = await this.transition(
              migration,
              executionToken,
              "validating",
              70,
            );
            break;
          case "validating":
            await this.port.validateShadow(context);
            migration = await this.transition(
              migration,
              executionToken,
              "cutting-over",
              85,
            );
            cutoverStarted = true;
            break;
          case "cutting-over":
            cutoverStarted = true;
            await this.port.cutover(context);
            migration = await this.uow.transaction(async (tx) => {
              const moved = await tx.resourceRepository.updateById(
                resource.id,
                {
                  serverId: migration.targetServerId,
                },
              );
              if (!moved)
                throw new Error("Failed to persist migration cutover");
              return await this.transitionOwned(
                tx,
                migration,
                executionToken,
                "awaiting-confirmation",
                95,
              );
            });
            await this.uow.deploymentRepository.updateById(
              migration.deploymentId,
              {
                status: "success",
                logs: "Migration cutover completed. Source retained pending explicit cleanup confirmation.\n",
              },
            );
            return migration;
          case "rolling-back":
            await this.port.rollback(context);
            await this.uow.resourceRepository.updateById(resource.id, {
              serverId:
                migration.sourceServerId === "local"
                  ? "local"
                  : migration.sourceServerId,
            });
            return await this.fail(
              migration,
              executionToken,
              "ROLLED_BACK",
              "Migration was rolled back after cutover",
            );
          case "awaiting-confirmation":
          case "completed":
          case "failed":
          case "cancelled":
            return migration;
        }
      }
    } catch (error) {
      const stepError =
        error instanceof MigrationStepError
          ? error
          : new MigrationStepError(
              "MIGRATION_STEP_FAILED",
              error instanceof Error ? error.message : String(error),
            );
      if (cutoverStarted) {
        const rollback = await this.transition(
          migration,
          executionToken,
          "rolling-back",
          migration.progress,
        ).catch(() => migration);
        try {
          await this.port.rollback(
            this.context(rollback, resource, executionToken),
          );
          await this.uow.resourceRepository.updateById(resource.id, {
            serverId:
              migration.sourceServerId === "local"
                ? "local"
                : migration.sourceServerId,
          });
        } catch (rollbackError) {
          stepError.message += `; rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`;
        }
      }
      return this.fail(
        migration,
        executionToken,
        stepError.code,
        stepError.message,
      );
    }
  }

  private context(
    migration: WorkloadMigration,
    resource: Parameters<WorkloadMigrationPort["preflight"]>[0]["resource"],
    executionToken: string,
  ): WorkloadMigrationContext {
    return {
      migration,
      resource,
      checkpoint: migration.checkpoint,
      onProgress: async (progress, checkpoint) => {
        const updated = await this.uow.workloadMigrationRepository.updateOwned(
          migration.id,
          executionToken,
          {
            progress,
            heartbeatAt: new Date(),
            ...(checkpoint ? { checkpoint } : {}),
          },
        );
        if (!updated) throw new Error("Migration execution lease was lost");
      },
    };
  }

  private async transition(
    migration: WorkloadMigration,
    executionToken: string,
    status: WorkloadMigrationStatus,
    progress: number,
    checkpoint?: WorkloadMigrationCheckpoint,
  ): Promise<WorkloadMigration> {
    return this.transitionOwned(
      this.uow,
      migration,
      executionToken,
      status,
      progress,
      checkpoint,
    );
  }

  private async transitionOwned(
    uow: IUnitOfWork,
    migration: WorkloadMigration,
    executionToken: string,
    status: WorkloadMigrationStatus,
    progress: number,
    checkpoint?: WorkloadMigrationCheckpoint,
  ): Promise<WorkloadMigration> {
    assertWorkloadMigrationTransition(migration.status, status);
    const updated = await uow.workloadMigrationRepository.updateOwned(
      migration.id,
      executionToken,
      {
        status,
        progress,
        heartbeatAt: new Date(),
        ...(checkpoint ? { checkpoint } : {}),
      },
    );
    if (!updated) throw new Error("Migration execution lease was lost");
    return updated;
  }

  private async cancel(
    migration: WorkloadMigration,
    resource: Parameters<WorkloadMigrationPort["preflight"]>[0]["resource"],
    executionToken: string,
  ): Promise<WorkloadMigration> {
    if (
      ["cutting-over", "awaiting-confirmation", "rolling-back"].includes(
        migration.status,
      )
    ) {
      throw new MigrationStepError(
        "CANCEL_REQUIRES_ROLLBACK",
        "Migration has reached cutover and must be rolled back explicitly",
      );
    }
    await this.port.cleanupShadow(
      this.context(migration, resource, executionToken),
    );
    const cancelled = await this.transition(
      migration,
      executionToken,
      "cancelled",
      migration.progress,
    );
    await this.uow.deploymentRepository.updateById(migration.deploymentId, {
      status: "cancelled",
      lastError: "Migration cancelled by operator",
    });
    return cancelled;
  }

  private async fail(
    migration: WorkloadMigration,
    executionToken: string,
    code: string,
    message: string,
  ): Promise<WorkloadMigration> {
    const failed = await this.uow.workloadMigrationRepository.updateOwned(
      migration.id,
      executionToken,
      {
        status: "failed",
        errorCode: code,
        errorMessage: message,
        completedAt: new Date(),
        heartbeatAt: null,
        executionToken: null,
      },
    );
    await this.uow.deploymentRepository.updateById(migration.deploymentId, {
      status: "failed",
      lastError: `${code}: ${message}`,
    });
    return failed ?? migration;
  }
}

class MigrationStepError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
