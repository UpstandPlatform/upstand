import {
  type BackupScheduleView,
  type IUnitOfWork,
  toBackupScheduleView,
  type UpdateBackupScheduleInput,
  ValidationError,
} from "@upstand/domain";
import {
  encryptedSourceCredentials,
  normalizeBackupScheduleInput,
  resolveBackupOrganizationId,
  scheduleWithInput,
  toScheduleUpdate,
  validateBackupSchedule,
} from "./backup-schedule.service";

export type { UpdateBackupScheduleInput } from "@upstand/domain";
export { UpdateBackupScheduleInputSchema } from "@upstand/domain";

export class UpdateBackupScheduleUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: UpdateBackupScheduleInput): Promise<BackupScheduleView> {
    const existing = await this.uow.backupScheduleRepository.findById(input.id);
    if (!existing) throw new ValidationError("Backup schedule not found");

    const resourceId = input.resourceId ?? existing.resourceId;
    if (!resourceId) {
      throw new ValidationError(
        "Use the web-server backup schedule update workflow for global backups",
      );
    }
    if (resourceId !== existing.resourceId) {
      throw new ValidationError(
        "A backup schedule cannot be moved to another resource",
      );
    }
    const resource = await this.uow.resourceRepository.findById(resourceId);
    if (!resource) throw new ValidationError("Resource not found");

    const merged = {
      ...scheduleWithInput(existing),
      ...input,
      resourceId,
    };
    const normalized = normalizeBackupScheduleInput(merged, resource, {
      allowExistingSourceCredentials: Boolean(existing.encryptedConfiguration),
    });
    validateBackupSchedule(normalized);

    const destination = await this.uow.s3DestinationRepository.findById(
      normalized.destinationId,
    );
    if (!destination) throw new ValidationError("Backup destination not found");
    const organizationId = await resolveBackupOrganizationId(
      this.uow,
      resource,
    );
    if (destination.organizationId !== organizationId) {
      throw new ValidationError(
        "Backup destination belongs to another organization",
      );
    }

    const updated = await this.uow.transaction((tx) =>
      tx.backupScheduleRepository.updateById(
        existing.id,
        toScheduleUpdate(
          normalized,
          normalized.sourceCredentials
            ? encryptedSourceCredentials(normalized)
            : existing.encryptedConfiguration,
        ),
      ),
    );
    if (!updated) throw new ValidationError("Backup schedule not found");
    return toBackupScheduleView(updated);
  }
}
