import type { BackupRun, CreateBackupRunDTO } from "../entities/backup";

export interface IBackupRunRepository {
  findById(id: string): Promise<BackupRun | null>;
  findByScheduleId(scheduleId: string, limit?: number): Promise<BackupRun[]>;
  findByResourceId(resourceId: string, limit?: number): Promise<BackupRun[]>;
  findByOrganizationId(
    organizationId: string,
    limit?: number,
  ): Promise<BackupRun[]>;
  findByStatus(status: string, limit?: number): Promise<BackupRun[]>;
  create(data: CreateBackupRunDTO): Promise<BackupRun>;
  updateById(
    id: string,
    patch: Partial<CreateBackupRunDTO>,
  ): Promise<BackupRun | null>;
  claimForExecution(id: string, startedAt: Date): Promise<BackupRun | null>;
  deleteById(id: string): Promise<boolean>;
}
