import {
  type BackupRun,
  type IUnitOfWork,
  type S3Destination,
  ValidationError,
} from "@upstand/domain";
import { log } from "evlog";
import type { PublishNotificationUseCase } from "../notification/publish-notification.usecase";
import {
  BackupRuntimeService,
  withBackupRuntime,
} from "./backup-runtime.service";
import { resolveBackupOrganizationId } from "./backup-schedule.service";
import { withBackupCaCertificate } from "./backup-storage";

export class ExecuteBackupRunUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly publisher: Pick<PublishNotificationUseCase, "execute">,
    private readonly runtime = new BackupRuntimeService(),
  ) {}

  async execute(runId: string, claimedRun?: BackupRun): Promise<BackupRun> {
    const existing =
      claimedRun ?? (await this.uow.backupRunRepository.findById(runId));
    if (!existing) throw new ValidationError("Backup run not found");
    if (existing.status === "succeeded") return existing;
    if (!claimedRun && existing.status !== "queued") {
      throw new ValidationError("Backup run is already being processed");
    }

    const run =
      claimedRun ??
      (await this.uow.backupRunRepository.claimForExecution(runId, new Date()));
    if (!run) {
      const current = await this.uow.backupRunRepository.findById(runId);
      if (current?.status === "succeeded") return current;
      throw new ValidationError("Backup run is already being processed");
    }

    const failBeforeExecution = async (message: string): Promise<never> => {
      await this.uow.backupRunRepository.updateById(run.id, {
        status: "failed",
        error: message,
        completedAt: new Date(),
      });
      throw new ValidationError(message);
    };

    const schedule = await this.uow.backupScheduleRepository.findById(
      run.scheduleId,
    );
    if (!schedule) return failBeforeExecution("Backup schedule not found");
    const resource = run.resourceId
      ? await this.uow.resourceRepository.findById(run.resourceId)
      : null;
    if (schedule.kind !== "web-server" && !resource) {
      return failBeforeExecution("Resource not found");
    }
    const destination = await this.uow.s3DestinationRepository.findById(
      run.destinationId,
    );
    if (!destination)
      return failBeforeExecution("Backup destination not found");

    const organizationId =
      schedule.organizationId ??
      (resource ? await resolveBackupOrganizationId(this.uow, resource) : null);
    if (!organizationId)
      return failBeforeExecution("Backup organization not found");
    if (destination.organizationId !== organizationId) {
      return failBeforeExecution(
        "Backup destination belongs to another organization",
      );
    }

    const caCert = destination.certificateId
      ? await this.uow.certificateRepository.findById(destination.certificateId)
      : null;
    const effectiveDestination = withBackupCaCertificate(
      destination,
      caCert?.certificatePem,
    );

    try {
      const fileKey =
        schedule.kind === "web-server"
          ? await this.runtime.createWebServerBackup(
              schedule,
              effectiveDestination,
            )
          : await withBackupRuntime(
              this.uow,
              resource as NonNullable<typeof resource>,
              this.runtime,
              (runtime) =>
                runtime.createBackup(
                  schedule,
                  resource as NonNullable<typeof resource>,
                  effectiveDestination,
                ),
            );
      const completed = await this.uow.backupRunRepository.updateById(run.id, {
        status: "succeeded",
        fileKey,
        error: null,
        completedAt: new Date(),
      });
      if (!completed)
        throw new Error("Backup run disappeared during execution");

      if (schedule.restoreVerification) {
        try {
          if (schedule.kind === "web-server") {
            await this.runtime.verifyBackup(
              schedule,
              effectiveDestination,
              fileKey,
            );
          } else {
            await withBackupRuntime(
              this.uow,
              resource as NonNullable<typeof resource>,
              this.runtime,
              (runtime) =>
                runtime.verifyBackup(
                  schedule,
                  effectiveDestination,
                  fileKey,
                  resource as NonNullable<typeof resource>,
                ),
            );
          }
          await this.uow.backupRunRepository.updateById(run.id, {
            verificationStatus: "verified",
            verifiedAt: new Date(),
            restoreTestedAt: new Date(),
            recoveryPoint: completedAt(completed),
          });
        } catch (verificationError) {
          await this.uow.backupRunRepository.updateById(run.id, {
            verificationStatus: "failed",
            verifiedAt: new Date(),
            error:
              `Backup created but verification failed: ${verificationError instanceof Error ? verificationError.message : String(verificationError)}`.slice(
                0,
                1_000,
              ),
          });
          throw verificationError;
        }
      }

      await this.enforceRetention(
        schedule.id,
        schedule.retentionCount,
        effectiveDestination,
      );
      await this.publishOutcome({
        organizationId,
        run: completed,
        resourceName: resource?.name ?? "Upstand web server",
        succeeded: true,
      });
      return completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await this.uow.backupRunRepository.updateById(run.id, {
        status: "failed",
        error: message.slice(0, 1_000),
        completedAt: new Date(),
      });
      await this.publishOutcome({
        organizationId,
        run: failed ?? run,
        resourceName: resource?.name ?? "Upstand web server",
        succeeded: false,
      });
      throw error;
    }
  }

  private async enforceRetention(
    scheduleId: string,
    retentionCount: number | null,
    destination: S3Destination,
  ): Promise<void> {
    if (!retentionCount || !destination) return;
    const runs = await this.uow.backupRunRepository.findByScheduleId(
      scheduleId,
      10_000,
    );
    const staleRuns = runs
      .filter(
        (candidate) => candidate.status === "succeeded" && candidate.fileKey,
      )
      .slice(retentionCount);

    for (const stale of staleRuns) {
      try {
        if (stale.kind === "web-server") {
          await this.runtime.deleteWebServerBackup(
            destination,
            stale.fileKey as string,
          );
        } else {
          await this.runtime.deleteBackup(destination, stale.fileKey as string);
        }
        await this.uow.backupRunRepository.deleteById(stale.id);
      } catch (error) {
        log.error({
          message: "Unable to delete expired backup",
          scheduleId,
          runId: stale.id,
          fileKey: stale.fileKey,
          err: error,
        });
      }
    }
  }

  private async publishOutcome(input: {
    organizationId: string;
    run: BackupRun;
    resourceName: string;
    succeeded: boolean;
  }): Promise<void> {
    const label =
      input.run.kind === "database"
        ? "Database"
        : input.run.kind === "web-server"
          ? "Web-server"
          : "Volume";
    const event =
      input.run.kind === "database"
        ? "database_backup_completed"
        : input.run.kind === "web-server"
          ? "web_server_backup_completed"
          : "volume_backup_completed";
    const backupEmoji =
      input.run.kind === "database"
        ? "💾"
        : input.run.kind === "web-server"
          ? "🌐"
          : "📁";
    const titlePrefix = input.succeeded
      ? `${backupEmoji} Backup Completed`
      : "⚠️ Backup Failed";
    await this.publisher
      .execute({
        organizationId: input.organizationId,
        event,
        idempotencyKey: `backup:${input.run.id}:${input.run.status}`,
        title: `${titlePrefix}: ${input.resourceName}`,
        message: input.succeeded
          ? `${label} backup for ${input.resourceName} completed successfully.`
          : `${label} backup for ${input.resourceName} failed: ${input.run.error ?? "unknown error"}`,
        metadata: {
          event,
          backupRunId: input.run.id,
          resourceId: input.run.resourceId,
          resourceName: input.resourceName,
          fileKey: input.run.fileKey,
          status: input.run.status,
          error: input.succeeded ? undefined : (input.run.error ?? undefined),
        },
      })
      .catch((error) => {
        log.error({
          message: "Unable to queue backup notification",
          backupRunId: input.run.id,
          err: error,
        });
      });
  }
}

function completedAt(run: { completedAt?: Date | null }): string | null {
  return run.completedAt?.toISOString() ?? new Date().toISOString();
}
