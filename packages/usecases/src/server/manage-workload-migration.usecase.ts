import { randomUUID } from "node:crypto";
import {
  assertWorkloadMigrationTransition,
  type IUnitOfWork,
  TERMINAL_WORKLOAD_MIGRATION_STATUSES,
  type WorkloadMigration,
} from "@upstand/domain";
import { z } from "zod";
import { OUTBOX_COMMAND_TYPES } from "../outbox/outbox-commands";
import type { WorkloadMigrationPort } from "../ports/workload-migration";

export const WorkloadMigrationIdInputSchema = z.object({
  organizationId: z.string().min(1),
  migrationId: z.string().min(1),
});

export const ResourceWorkloadMigrationInputSchema = z.object({
  organizationId: z.string().min(1),
  resourceId: z.string().min(1),
});

export const ConfirmWorkloadMigrationInputSchema =
  WorkloadMigrationIdInputSchema.extend({
    confirmCleanup: z.literal(true),
  });

export class GetWorkloadMigrationUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: z.infer<typeof WorkloadMigrationIdInputSchema>) {
    return ownedMigration(this.uow, input.organizationId, input.migrationId);
  }
}

export class GetResourceWorkloadMigrationUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: z.infer<typeof ResourceWorkloadMigrationInputSchema>) {
    const resource = await this.uow.resourceRepository.findById(
      input.resourceId,
    );
    const environment = resource
      ? await this.uow.environmentRepository.findById(resource.environmentId)
      : null;
    const project = environment
      ? await this.uow.projectRepository.findById(environment.projectId)
      : null;
    if (
      !resource ||
      !project ||
      project.organizationId !== input.organizationId
    ) {
      throw new Error("Resource not found");
    }
    const migrations =
      await this.uow.workloadMigrationRepository.findByResourceId(
        resource.id,
        50,
      );
    return migrations.at(0) ?? null;
  }
}

export class CancelWorkloadMigrationUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: z.infer<typeof WorkloadMigrationIdInputSchema>,
  ): Promise<WorkloadMigration> {
    const migration = await ownedMigration(
      this.uow,
      input.organizationId,
      input.migrationId,
    );
    if (TERMINAL_WORKLOAD_MIGRATION_STATUSES.has(migration.status)) {
      return migration;
    }
    if (
      ["cutting-over", "awaiting-confirmation", "rolling-back"].includes(
        migration.status,
      )
    ) {
      throw new Error(
        "Migration reached cutover; request rollback instead of cancellation",
      );
    }
    const updated = await this.uow.workloadMigrationRepository.updateById(
      migration.id,
      { cancelRequested: true },
    );
    if (!updated) throw new Error("Migration could not be cancelled");
    return updated;
  }
}

export class RollbackWorkloadMigrationUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: z.infer<typeof WorkloadMigrationIdInputSchema>,
  ): Promise<WorkloadMigration> {
    return this.uow.transaction(async (tx) => {
      const migration = await ownedMigration(
        tx,
        input.organizationId,
        input.migrationId,
      );
      if (migration.status === "failed" || migration.status === "cancelled") {
        return migration;
      }
      assertWorkloadMigrationTransition(migration.status, "rolling-back");
      const updated = await tx.workloadMigrationRepository.updateById(
        migration.id,
        {
          status: "rolling-back",
          executionToken: null,
          heartbeatAt: null,
        },
      );
      if (!updated) throw new Error("Migration could not enter rollback");
      await tx.outboxRepository.create({
        id: randomUUID(),
        type: OUTBOX_COMMAND_TYPES.migrate,
        payload: {
          migrationId: migration.id,
          deploymentId: migration.deploymentId,
          resourceId: migration.resourceId,
          sourceServerId: migration.sourceServerId,
          targetServerId: migration.targetServerId,
        },
        aggregateType: "workload_migration",
        aggregateId: migration.id,
        organizationId: migration.organizationId,
        idempotencyKey: `migration-rollback:${migration.id}:${migration.updatedAt.getTime()}`,
      });
      return updated;
    });
  }
}

export class ConfirmWorkloadMigrationUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly port: WorkloadMigrationPort,
  ) {}

  async execute(
    input: z.infer<typeof ConfirmWorkloadMigrationInputSchema>,
  ): Promise<WorkloadMigration> {
    const migration = await ownedMigration(
      this.uow,
      input.organizationId,
      input.migrationId,
    );
    if (migration.status === "completed") return migration;
    if (migration.status !== "awaiting-confirmation") {
      throw new Error("Migration is not awaiting cleanup confirmation");
    }
    const resource = await this.uow.resourceRepository.findById(
      migration.resourceId,
    );
    if (!resource) throw new Error("Resource not found");
    await this.port.cleanupSource({
      migration,
      resource,
      checkpoint: migration.checkpoint,
      onProgress: async (progress, checkpoint) => {
        await this.uow.workloadMigrationRepository.updateById(migration.id, {
          progress,
          ...(checkpoint ? { checkpoint } : {}),
        });
      },
    });
    return this.uow.transaction(async (tx) => {
      const current = await ownedMigration(
        tx,
        input.organizationId,
        input.migrationId,
      );
      if (current.status === "completed") return current;
      assertWorkloadMigrationTransition(current.status, "completed");
      const completed = await tx.workloadMigrationRepository.updateById(
        current.id,
        {
          status: "completed",
          progress: 100,
          cleanupConfirmed: true,
          sourceRetained: false,
          completedAt: new Date(),
          heartbeatAt: null,
          executionToken: null,
        },
      );
      if (!completed)
        throw new Error("Migration cleanup could not be recorded");
      return completed;
    });
  }
}

async function ownedMigration(
  uow: IUnitOfWork,
  organizationId: string,
  migrationId: string,
): Promise<WorkloadMigration> {
  const migration = await uow.workloadMigrationRepository.findById(migrationId);
  if (!migration || migration.organizationId !== organizationId) {
    throw new Error("Workload migration not found");
  }
  return migration;
}
