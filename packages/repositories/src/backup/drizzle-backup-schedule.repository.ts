import { backupSchedule } from "@upstand/db";
import type {
  BackupSchedule,
  CreateBackupScheduleDTO,
  IBackupScheduleRepository,
} from "@upstand/domain";
import { desc, eq } from "drizzle-orm";
import type { Executor } from "../shared/types";

export class DrizzleBackupScheduleRepository
  implements IBackupScheduleRepository
{
  constructor(private readonly executor: Executor) {}

  async findById(id: string): Promise<BackupSchedule | null> {
    const [schedule] = await this.executor
      .select()
      .from(backupSchedule)
      .where(eq(backupSchedule.id, id))
      .limit(1);
    return (schedule as BackupSchedule | undefined) ?? null;
  }

  async findByResourceId(resourceId: string): Promise<BackupSchedule[]> {
    return (await this.executor
      .select()
      .from(backupSchedule)
      .where(eq(backupSchedule.resourceId, resourceId))
      .orderBy(desc(backupSchedule.createdAt))) as BackupSchedule[];
  }

  async findByOrganizationId(
    organizationId: string,
  ): Promise<BackupSchedule[]> {
    return (await this.executor
      .select()
      .from(backupSchedule)
      .where(eq(backupSchedule.organizationId, organizationId))
      .orderBy(desc(backupSchedule.createdAt))) as BackupSchedule[];
  }

  async findEnabled(): Promise<BackupSchedule[]> {
    return (await this.executor
      .select()
      .from(backupSchedule)
      .where(eq(backupSchedule.enabled, true))) as BackupSchedule[];
  }

  async create(data: CreateBackupScheduleDTO): Promise<BackupSchedule> {
    const [schedule] = await this.executor
      .insert(backupSchedule)
      .values(data)
      .returning();
    if (!schedule)
      throw new Error("create: insert returned no backup schedule");
    return schedule as BackupSchedule;
  }

  async updateById(
    id: string,
    patch: Partial<CreateBackupScheduleDTO>,
  ): Promise<BackupSchedule | null> {
    const [schedule] = await this.executor
      .update(backupSchedule)
      .set(patch)
      .where(eq(backupSchedule.id, id))
      .returning();
    return (schedule as BackupSchedule | undefined) ?? null;
  }

  async deleteById(id: string): Promise<boolean> {
    const deleted = await this.executor
      .delete(backupSchedule)
      .where(eq(backupSchedule.id, id))
      .returning({ id: backupSchedule.id });
    return deleted.length > 0;
  }
}
