import { randomUUID } from "node:crypto";
import {
  type BackupScheduleView,
  type CreateBackupScheduleInput,
  type IUnitOfWork,
  toBackupScheduleView,
  ValidationError,
} from "@upstand/domain";
import {
  encryptedSourceCredentials,
  normalizeBackupScheduleInput,
  resolveBackupOrganizationId,
  toScheduleUpdate,
  validateBackupSchedule,
} from "./backup-schedule.service";

export type { CreateBackupScheduleInput } from "@upstand/domain";
export { CreateBackupScheduleInputSchema } from "@upstand/domain";

export class CreateBackupScheduleUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: CreateBackupScheduleInput): Promise<BackupScheduleView> {
    const resource = await this.uow.resourceRepository.findById(
      input.resourceId,
    );
    if (!resource) throw new ValidationError("Resource not found");

    const destination = await this.uow.s3DestinationRepository.findById(
      input.destinationId,
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

    const normalized = normalizeBackupScheduleInput(input, resource);
    validateBackupSchedule(normalized);
    const schedule = await this.uow.transaction((tx) =>
      tx.backupScheduleRepository.create({
        id: randomUUID(),
        organizationId,
        ...toScheduleUpdate(normalized, encryptedSourceCredentials(normalized)),
      }),
    );
    return toBackupScheduleView(schedule);
  }
}
