import { Worker } from "bullmq";
import { withJobTelemetry } from "../observability/job-telemetry";
import { ManagedQueueWorker } from "../shared/managed-queue-worker";
import { BACKUP_RUN_QUEUE } from "./trigger-backup-run.usecase";

export interface BackupRunJob {
  id?: string | number;
  data: { runId?: string; correlationId?: string };
  opts: { attempts?: number };
  attemptsMade: number;
}

export type BackupRunHandler = (job: BackupRunJob) => Promise<void>;

export class BackupRunWorker {
  private readonly worker: ManagedQueueWorker;

  constructor(handleBackupRun: BackupRunHandler) {
    this.worker = new ManagedQueueWorker({
      loggerName: "backup-worker",
      failedMessage: "Backup run job failed",
      connectionErrorMessage: "Backup worker connection error",
      createWorker: (connection) =>
        new Worker(
          BACKUP_RUN_QUEUE,
          (job) =>
            withJobTelemetry(
              {
                operation: "backup.execute",
                queue: BACKUP_RUN_QUEUE,
                jobId: job.id,
                correlationId: job.data?.correlationId,
                attempt: job.attemptsMade + 1,
                fields: { backup: { runId: job.data?.runId } },
              },
              () => handleBackupRun(job),
            ),
          {
            connection: connection as never,
            concurrency: 2,
            maxStalledCount: 1,
            stalledInterval: 30_000,
          },
        ),
      getFailedJobContext: (job) => ({ runId: job?.data?.runId }),
    });
  }

  start(): Promise<void> {
    return this.worker.start();
  }

  isReady(): boolean {
    return this.worker.isReady();
  }

  stop(): Promise<void> {
    return this.worker.stop();
  }
}
