import { workloadMigration } from "@upstand/db";
import {
  type CreateWorkloadMigrationDTO,
  type IWorkloadMigrationRepository,
  TERMINAL_WORKLOAD_MIGRATION_STATUSES,
  type UpdateWorkloadMigrationDTO,
  type WorkloadMigration,
  WorkloadMigrationCheckpointSchema,
} from "@upstand/domain";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { Executor } from "../shared/types";

const ACTIVE_STATUSES = [
  "queued",
  "preflight",
  "transferring",
  "shadow-deploying",
  "validating",
  "cutting-over",
  "awaiting-confirmation",
  "rolling-back",
] as const;

export class DrizzleWorkloadMigrationRepository
  implements IWorkloadMigrationRepository
{
  constructor(private readonly executor: Executor) {}

  async findById(id: string): Promise<WorkloadMigration | null> {
    const [migration] = await this.executor
      .select()
      .from(workloadMigration)
      .where(eq(workloadMigration.id, id))
      .limit(1);
    return (migration as WorkloadMigration | undefined) ?? null;
  }

  async findByResourceId(
    resourceId: string,
    limit = 50,
  ): Promise<WorkloadMigration[]> {
    return (await this.executor
      .select()
      .from(workloadMigration)
      .where(eq(workloadMigration.resourceId, resourceId))
      .orderBy(asc(workloadMigration.createdAt))
      .limit(Math.max(1, Math.min(limit, 500)))) as WorkloadMigration[];
  }

  async findResumable(limit = 100): Promise<WorkloadMigration[]> {
    return (await this.executor
      .select()
      .from(workloadMigration)
      .where(
        notInArray(workloadMigration.status, [
          ...TERMINAL_WORKLOAD_MIGRATION_STATUSES,
          "awaiting-confirmation",
        ]),
      )
      .orderBy(asc(workloadMigration.updatedAt))
      .limit(Math.max(1, Math.min(limit, 500)))) as WorkloadMigration[];
  }

  async create(input: CreateWorkloadMigrationDTO): Promise<WorkloadMigration> {
    const [migration] = await this.executor
      .insert(workloadMigration)
      .values({
        ...input,
        checkpoint: WorkloadMigrationCheckpointSchema.parse(
          input.checkpoint ?? {},
        ),
      })
      .returning();
    if (!migration) throw new Error("create: insert returned no migration");
    return migration as WorkloadMigration;
  }

  async updateById(
    id: string,
    patch: UpdateWorkloadMigrationDTO,
  ): Promise<WorkloadMigration | null> {
    const [migration] = await this.executor
      .update(workloadMigration)
      .set({
        ...patch,
        ...(patch.checkpoint
          ? {
              checkpoint: WorkloadMigrationCheckpointSchema.parse(
                patch.checkpoint,
              ),
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(workloadMigration.id, id))
      .returning();
    return (migration as WorkloadMigration | undefined) ?? null;
  }

  async claim(
    id: string,
    executionToken: string,
    now: Date,
    staleBefore: Date,
  ): Promise<WorkloadMigration | null> {
    const [migration] = await this.executor
      .update(workloadMigration)
      .set({
        executionToken,
        attempt: sql`${workloadMigration.attempt} + 1`,
        heartbeatAt: now,
        startedAt: sql`coalesce(${workloadMigration.startedAt}, ${now})`,
        updatedAt: now,
      })
      .where(
        and(
          eq(workloadMigration.id, id),
          inArray(workloadMigration.status, [...ACTIVE_STATUSES]),
          or(
            eq(workloadMigration.status, "queued"),
            isNull(workloadMigration.executionToken),
            lt(workloadMigration.heartbeatAt, staleBefore),
            and(
              eq(workloadMigration.executionToken, executionToken),
              inArray(workloadMigration.status, [...ACTIVE_STATUSES]),
            ),
          ),
        ),
      )
      .returning();
    return (migration as WorkloadMigration | undefined) ?? null;
  }

  async updateOwned(
    id: string,
    executionToken: string,
    patch: UpdateWorkloadMigrationDTO,
  ): Promise<WorkloadMigration | null> {
    const [migration] = await this.executor
      .update(workloadMigration)
      .set({
        ...patch,
        ...(patch.checkpoint
          ? {
              checkpoint: WorkloadMigrationCheckpointSchema.parse(
                patch.checkpoint,
              ),
            }
          : {}),
        heartbeatAt: "heartbeatAt" in patch ? patch.heartbeatAt : new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workloadMigration.id, id),
          eq(workloadMigration.executionToken, executionToken),
          notInArray(workloadMigration.status, [
            ...TERMINAL_WORKLOAD_MIGRATION_STATUSES,
          ]),
        ),
      )
      .returning();
    return (migration as WorkloadMigration | undefined) ?? null;
  }
}
