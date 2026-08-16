import type { BackupRun, CreateBackupRunDTO } from "../entities/backup";

export const BACKUP_RUN_EXECUTION_LEASE_MS = 5 * 60_000;

export interface BackupRunPageCursor {
  createdAt: Date;
  id: string;
}

export interface IBackupRunRepository {
  findById(id: string): Promise<BackupRun | null>;
  findByScheduleId(scheduleId: string, limit?: number): Promise<BackupRun[]>;
  findByScheduleIdPage(
    scheduleId: string,
    options?: { cursor?: BackupRunPageCursor; limit?: number },
  ): Promise<BackupRun[]>;
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
  claimForExecution(
    id: string,
    startedAt: Date,
    leaseMs?: number,
  ): Promise<BackupRun | null>;
  heartbeatExecution?(id: string, now: Date): Promise<BackupRun | null>;
  requeueStaleForRecovery?(
    id: string,
    recoveredAt: Date,
    leaseMs?: number,
  ): Promise<BackupRun | null>;
  deleteById(id: string): Promise<boolean>;
}
