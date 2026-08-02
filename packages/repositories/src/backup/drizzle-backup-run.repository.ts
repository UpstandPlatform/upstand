import { backupRun } from "@upstand/db";
import type {
  BackupRun,
  BackupRunPageCursor,
  CreateBackupRunDTO,
  IBackupRunRepository,
} from "@upstand/domain";
import { BACKUP_RUN_EXECUTION_LEASE_MS } from "@upstand/domain";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { Executor } from "../shared/types";

export class DrizzleBackupRunRepository implements IBackupRunRepository {
  constructor(private readonly executor: Executor) {}

  private boundedLimit(limit: number, maximum = 1_000): number {
    return Math.max(1, Math.min(limit, maximum));
  }

  async findById(id: string): Promise<BackupRun | null> {
    const [run] = await this.executor
      .select()
      .from(backupRun)
      .where(eq(backupRun.id, id))
      .limit(1);
    return (run as BackupRun | undefined) ?? null;
  }

  async findByScheduleId(scheduleId: string, limit = 50): Promise<BackupRun[]> {
    return (await this.executor
      .select()
      .from(backupRun)
      .where(eq(backupRun.scheduleId, scheduleId))
      .orderBy(desc(backupRun.createdAt), desc(backupRun.id))
      .limit(this.boundedLimit(limit))) as BackupRun[];
  }

  async findByScheduleIdPage(
    scheduleId: string,
    options: { cursor?: BackupRunPageCursor; limit?: number } = {},
  ): Promise<BackupRun[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 500, 500));
    const cursor = options.cursor;
    const cursorCondition = cursor
      ? or(
          lt(backupRun.createdAt, cursor.createdAt),
          and(
            eq(backupRun.createdAt, cursor.createdAt),
            lt(backupRun.id, cursor.id),
          ),
        )
      : undefined;
    const where = cursorCondition
      ? and(eq(backupRun.scheduleId, scheduleId), cursorCondition)
      : eq(backupRun.scheduleId, scheduleId);

    return (await this.executor
      .select()
      .from(backupRun)
      .where(where)
      .orderBy(desc(backupRun.createdAt), desc(backupRun.id))
      .limit(limit)) as BackupRun[];
  }

  async findByResourceId(resourceId: string, limit = 50): Promise<BackupRun[]> {
    return (await this.executor
      .select()
      .from(backupRun)
      .where(eq(backupRun.resourceId, resourceId))
      .orderBy(desc(backupRun.createdAt))
      .limit(this.boundedLimit(limit))) as BackupRun[];
  }

  async findByOrganizationId(
    organizationId: string,
    limit = 50,
  ): Promise<BackupRun[]> {
    return (await this.executor
      .select()
      .from(backupRun)
      .where(eq(backupRun.organizationId, organizationId))
      .orderBy(desc(backupRun.createdAt))
      .limit(this.boundedLimit(limit))) as BackupRun[];
  }

  async findByStatus(status: string, limit = 500): Promise<BackupRun[]> {
    return (await this.executor
      .select()
      .from(backupRun)
      .where(eq(backupRun.status, status))
      .orderBy(desc(backupRun.createdAt))
      .limit(this.boundedLimit(limit))) as BackupRun[];
  }

  async create(data: CreateBackupRunDTO): Promise<BackupRun> {
    const [run] = await this.executor
      .insert(backupRun)
      .values(data)
      .returning();
    if (!run) throw new Error("create: insert returned no backup run");
    return run as BackupRun;
  }

  async updateById(
    id: string,
    patch: Partial<CreateBackupRunDTO>,
  ): Promise<BackupRun | null> {
    const [run] = await this.executor
      .update(backupRun)
      .set(patch)
      .where(eq(backupRun.id, id))
      .returning();
    return (run as BackupRun | undefined) ?? null;
  }

  async claimForExecution(
    id: string,
    startedAt: Date,
    leaseMs = BACKUP_RUN_EXECUTION_LEASE_MS,
  ): Promise<BackupRun | null> {
    const staleBefore = new Date(startedAt.getTime() - leaseMs);
    const [run] = await this.executor
      .update(backupRun)
      .set({
        status: "running",
        error: null,
        startedAt,
        completedAt: null,
        updatedAt: startedAt,
      })
      // BullMQ retries the same run after the use case records a failed
      // attempt. Allow that retry to reclaim the run while retaining the
      // compare-and-set protection against concurrent workers.
      .where(
        and(
          eq(backupRun.id, id),
          or(
            inArray(backupRun.status, ["queued", "failed"]),
            and(
              eq(backupRun.status, "running"),
              lt(backupRun.updatedAt, staleBefore),
            ),
          ),
        ),
      )
      .returning();
    return (run as BackupRun | undefined) ?? null;
  }

  async heartbeatExecution(id: string, now: Date): Promise<BackupRun | null> {
    const [run] = await this.executor
      .update(backupRun)
      .set({ updatedAt: now })
      .where(and(eq(backupRun.id, id), eq(backupRun.status, "running")))
      .returning();
    return (run as BackupRun | undefined) ?? null;
  }

  async requeueStaleForRecovery(
    id: string,
    recoveredAt: Date,
    leaseMs = BACKUP_RUN_EXECUTION_LEASE_MS,
  ): Promise<BackupRun | null> {
    const staleBefore = new Date(recoveredAt.getTime() - leaseMs);
    const [run] = await this.executor
      .update(backupRun)
      .set({
        status: "queued",
        error: "Recovered after the backup worker execution lease expired",
        completedAt: null,
        updatedAt: recoveredAt,
      })
      .where(
        and(
          eq(backupRun.id, id),
          eq(backupRun.status, "running"),
          lt(backupRun.updatedAt, staleBefore),
        ),
      )
      .returning();
    return (run as BackupRun | undefined) ?? null;
  }

  async deleteById(id: string): Promise<boolean> {
    const deleted = await this.executor
      .delete(backupRun)
      .where(eq(backupRun.id, id))
      .returning({ id: backupRun.id });
    return deleted.length > 0;
  }
}
