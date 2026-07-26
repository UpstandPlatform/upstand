import type {
  BackupSchedule,
  CreateBackupScheduleDTO,
} from "../entities/backup";

export interface IBackupScheduleRepository {
  findById(id: string): Promise<BackupSchedule | null>;
  findByResourceId(resourceId: string): Promise<BackupSchedule[]>;
  findByOrganizationId(organizationId: string): Promise<BackupSchedule[]>;
  findEnabled(): Promise<BackupSchedule[]>;
  create(data: CreateBackupScheduleDTO): Promise<BackupSchedule>;
  updateById(
    id: string,
    patch: Partial<CreateBackupScheduleDTO>,
  ): Promise<BackupSchedule | null>;
  deleteById(id: string): Promise<boolean>;
}
