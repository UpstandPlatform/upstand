import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { z } from "zod";
import { resolveCertificateForOrganization } from "../certificate/certificate-reference";
import { forEachBackupRunBySchedule } from "./backup-run-pagination";
import { BackupRuntimeService } from "./backup-runtime.service";
import { withBackupCaCertificate } from "./backup-storage";

export const DeleteBackupScheduleInputSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1).optional(),
});
export type DeleteBackupScheduleInput = z.infer<
  typeof DeleteBackupScheduleInputSchema
>;

/** Removes retained objects before deleting the schedule, preventing orphaned backups. */
export class DeleteBackupScheduleUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly runtime = new BackupRuntimeService(),
  ) {}

  async execute(input: DeleteBackupScheduleInput): Promise<boolean> {
    const schedule = await this.uow.backupScheduleRepository.findById(input.id);
    if (!schedule) throw new ValidationError("Backup schedule not found");
    if (input.organizationId !== schedule.organizationId) {
      throw new ValidationError(
        "Backup schedule belongs to another organization",
      );
    }
    const destination = await this.uow.s3DestinationRepository.findById(
      schedule.destinationId,
    );
    if (!destination) throw new ValidationError("Backup destination not found");
    if (destination.organizationId !== schedule.organizationId) {
      throw new ValidationError(
        "Backup destination belongs to another organization",
      );
    }
    const certificate = await resolveCertificateForOrganization(
      this.uow,
      destination.certificateId,
      schedule.organizationId,
    );
    const effectiveDestination = withBackupCaCertificate(
      destination,
      certificate?.certificatePem,
    );

    await forEachBackupRunBySchedule(
      this.uow.backupRunRepository,
      schedule.id,
      async (run) => {
        if (!run.fileKey) return;
        if (schedule.kind === "web-server") {
          await this.runtime.deleteWebServerBackup(
            effectiveDestination,
            run.fileKey,
          );
        } else {
          await this.runtime.deleteBackup(effectiveDestination, run.fileKey);
        }
      },
    );
    return this.uow.transaction((tx) =>
      tx.backupScheduleRepository.deleteById(schedule.id),
    );
  }
}
