import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { resolveCertificateForOrganization } from "../certificate/certificate-reference";
import {
  BackupRuntimeService,
  withBackupRuntime,
} from "./backup-runtime.service";
import { resolveBackupOrganizationId } from "./backup-schedule.service";
import { withBackupCaCertificate } from "./backup-storage";

export class VerifyBackupRunUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly runtime = new BackupRuntimeService(),
  ) {}

  async execute(runId: string) {
    const run = await this.uow.backupRunRepository.findById(runId);
    if (run?.status !== "succeeded" || !run.fileKey)
      throw new ValidationError("Completed backup artifact not found");
    const schedule = await this.uow.backupScheduleRepository.findById(
      run.scheduleId,
    );
    const destination = await this.uow.s3DestinationRepository.findById(
      run.destinationId,
    );
    if (!schedule || !destination)
      throw new ValidationError("Backup configuration not found");
    const resource = run.resourceId
      ? await this.uow.resourceRepository.findById(run.resourceId)
      : null;
    const organizationId =
      schedule.organizationId ??
      (resource ? await resolveBackupOrganizationId(this.uow, resource) : null);
    if (!organizationId || run.organizationId !== organizationId) {
      throw new ValidationError("Backup run belongs to another organization");
    }
    if (destination.organizationId !== organizationId) {
      throw new ValidationError(
        "Backup destination belongs to another organization",
      );
    }
    const certificate = await resolveCertificateForOrganization(
      this.uow,
      destination.certificateId,
      organizationId,
    );
    const effectiveDestination = withBackupCaCertificate(
      destination,
      certificate?.certificatePem,
    );
    try {
      if (schedule.kind === "web-server") {
        await this.runtime.verifyBackup(
          schedule,
          effectiveDestination,
          run.fileKey,
        );
      } else {
        if (!resource) throw new ValidationError("Resource not found");
        await withBackupRuntime(this.uow, resource, this.runtime, (runtime) =>
          runtime.verifyBackup(
            schedule,
            effectiveDestination,
            run.fileKey as string,
            resource,
          ),
        );
      }
      return (
        (await this.uow.backupRunRepository.updateById(run.id, {
          verificationStatus: "verified",
          verifiedAt: new Date(),
          restoreTestedAt: new Date(),
          recoveryPoint: run.completedAt?.toISOString() ?? null,
        })) ?? run
      );
    } catch (error) {
      await this.uow.backupRunRepository.updateById(run.id, {
        verificationStatus: "failed",
        verifiedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
