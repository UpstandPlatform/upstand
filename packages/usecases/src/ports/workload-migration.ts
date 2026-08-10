import type {
  Resource,
  WorkloadMigration,
  WorkloadMigrationCheckpoint,
} from "@upstand/domain";

export interface WorkloadMigrationContext {
  migration: WorkloadMigration;
  resource: Resource;
  checkpoint: WorkloadMigrationCheckpoint;
  onProgress: (
    progress: number,
    checkpoint?: WorkloadMigrationCheckpoint,
  ) => Promise<void>;
}

export interface WorkloadMigrationPreflightResult {
  checks: ReadonlyArray<{
    code: string;
    ok: boolean;
    message: string;
  }>;
  checkpoint?: WorkloadMigrationCheckpoint;
}

export interface WorkloadMigrationPort {
  preflight(
    context: WorkloadMigrationContext,
  ): Promise<WorkloadMigrationPreflightResult>;
  transfer(context: WorkloadMigrationContext): Promise<void>;
  deployShadow(context: WorkloadMigrationContext): Promise<void>;
  validateShadow(context: WorkloadMigrationContext): Promise<void>;
  cutover(context: WorkloadMigrationContext): Promise<void>;
  rollback(context: WorkloadMigrationContext): Promise<void>;
  cleanupSource(context: WorkloadMigrationContext): Promise<void>;
  cleanupShadow(context: WorkloadMigrationContext): Promise<void>;
}
