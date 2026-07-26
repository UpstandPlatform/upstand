import { Worker } from "bullmq";
import { ManagedQueueWorker } from "../shared/managed-queue-worker";
import { BACKUP_RUN_QUEUE } from "./trigger-backup-run.usecase";

export interface BackupRunJob {
  data: { runId?: string };
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
        new Worker(BACKUP_RUN_QUEUE, (job) => handleBackupRun(job), {
          connection: connection as never,
          concurrency: 2,
          maxStalledCount: 1,
          stalledInterval: 30_000,
        }),
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
