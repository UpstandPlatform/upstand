import { randomUUID } from "node:crypto";
import {
  type BackupRun,
  type IUnitOfWork,
  ValidationError,
} from "@upstand/domain";
import { z } from "zod";
import {
  type BackupRunOutboxPayload,
  OUTBOX_COMMAND_TYPES,
} from "../outbox/outbox-commands";
import { acquireBackupRunLock, releaseBackupRunLock } from "./backup-run-lock";

export const BACKUP_RUN_QUEUE = "backup-run";

export const TriggerBackupRunInputSchema = z.object({
  scheduleId: z.string().min(1),
});
export type TriggerBackupRunInput = z.infer<typeof TriggerBackupRunInputSchema>;

export { backupRunLockKey } from "./backup-run-lock";

/**
 * Creates a durable run record and its publication intent atomically. The
 * Redis lock makes cron execution safe when more than one API process is
 * running.
 */
export class TriggerBackupRunUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: TriggerBackupRunInput): Promise<BackupRun | null> {
    const schedule = await this.uow.backupScheduleRepository.findById(
      input.scheduleId,
    );
    if (!schedule) throw new ValidationError("Backup schedule not found");

    const runId = randomUUID();
    if (!(await acquireBackupRunLock(schedule.id, runId))) return null;

    try {
      return await this.uow.transaction(async (tx) => {
        const run = await tx.backupRunRepository.create({
          id: runId,
          scheduleId: schedule.id,
          resourceId: schedule.resourceId,
          organizationId: schedule.organizationId,
          destinationId: schedule.destinationId,
          kind: schedule.kind,
          status: "queued",
        });
        const payload: BackupRunOutboxPayload = { runId: run.id };
        await tx.outboxRepository.create({
          id: run.id,
          type: OUTBOX_COMMAND_TYPES.backupRun,
          payload,
          aggregateType: "backup_run",
          aggregateId: run.id,
          organizationId: run.organizationId,
          idempotencyKey: `backup-run:${run.id}`,
        });
        return run;
      });
    } catch (error) {
      await releaseBackupRunLock(schedule.id, runId);
      throw error;
    }
  }
}
