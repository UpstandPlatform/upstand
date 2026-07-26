import { backupRun } from "@upstand/db";
import type {
  BackupRun,
  CreateBackupRunDTO,
  IBackupRunRepository,
} from "@upstand/domain";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Executor } from "../shared/types";

export class DrizzleBackupRunRepository implements IBackupRunRepository {
  constructor(private readonly executor: Executor) {}

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
      .orderBy(desc(backupRun.createdAt))
      .limit(limit)) as BackupRun[];
  }

  async findByResourceId(resourceId: string, limit = 50): Promise<BackupRun[]> {
    return (await this.executor
      .select()
      .from(backupRun)
      .where(eq(backupRun.resourceId, resourceId))
      .orderBy(desc(backupRun.createdAt))
      .limit(limit)) as BackupRun[];
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
      .limit(limit)) as BackupRun[];
  }

  async findByStatus(status: string, limit = 500): Promise<BackupRun[]> {
    return (await this.executor
      .select()
      .from(backupRun)
      .where(eq(backupRun.status, status))
      .orderBy(desc(backupRun.createdAt))
      .limit(Math.max(1, Math.min(limit, 1_000)))) as BackupRun[];
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
  ): Promise<BackupRun | null> {
    const [run] = await this.executor
      .update(backupRun)
      .set({
        status: "running",
        error: null,
        startedAt,
        completedAt: null,
      })
      // BullMQ retries the same run after the use case records a failed
      // attempt. Allow that retry to reclaim the run while retaining the
      // compare-and-set protection against concurrent workers.
      .where(
        and(
          eq(backupRun.id, id),
          inArray(backupRun.status, ["queued", "failed"]),
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
