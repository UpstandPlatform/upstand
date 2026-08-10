import { z } from "zod";

export const WorkloadMigrationStatusSchema = z.enum([
  "queued",
  "preflight",
  "transferring",
  "shadow-deploying",
  "validating",
  "cutting-over",
  "awaiting-confirmation",
  "rolling-back",
  "completed",
  "failed",
  "cancelled",
]);
export type WorkloadMigrationStatus = z.infer<
  typeof WorkloadMigrationStatusSchema
>;

export const TERMINAL_WORKLOAD_MIGRATION_STATUSES =
  new Set<WorkloadMigrationStatus>(["completed", "failed", "cancelled"]);

const SAFE_CHECKPOINT_KEY =
  /^(?!.*(?:secret|token|password|credential|private.?key)).+$/i;

export const WorkloadMigrationCheckpointSchema = z
  .record(
    z
      .string()
      .regex(SAFE_CHECKPOINT_KEY, "Sensitive checkpoint keys are forbidden"),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  )
  .default({});
export type WorkloadMigrationCheckpoint = z.infer<
  typeof WorkloadMigrationCheckpointSchema
>;

export const WorkloadMigrationSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  resourceId: z.string().min(1),
  deploymentId: z.string().min(1),
  sourceServerId: z.string().min(1),
  targetServerId: z.string().min(1),
  status: WorkloadMigrationStatusSchema,
  progress: z.number().int().min(0).max(100),
  executionToken: z.string().nullable(),
  attempt: z.number().int().nonnegative(),
  cancelRequested: z.boolean(),
  cleanupConfirmed: z.boolean(),
  sourceRetained: z.boolean(),
  checkpoint: WorkloadMigrationCheckpointSchema,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  heartbeatAt: z.date().nullable(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type WorkloadMigration = z.infer<typeof WorkloadMigrationSchema>;

export interface CreateWorkloadMigrationDTO {
  id: string;
  organizationId: string;
  resourceId: string;
  deploymentId: string;
  sourceServerId: string;
  targetServerId: string;
  status?: WorkloadMigrationStatus;
  progress?: number;
  checkpoint?: Record<string, string | number | boolean | null>;
}

export interface UpdateWorkloadMigrationDTO {
  status?: WorkloadMigrationStatus;
  progress?: number;
  executionToken?: string | null;
  attempt?: number;
  cancelRequested?: boolean;
  cleanupConfirmed?: boolean;
  sourceRetained?: boolean;
  checkpoint?: Record<string, string | number | boolean | null>;
  errorCode?: string | null;
  errorMessage?: string | null;
  heartbeatAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

const ALLOWED_TRANSITIONS: Record<
  WorkloadMigrationStatus,
  readonly WorkloadMigrationStatus[]
> = {
  queued: ["preflight", "cancelled"],
  preflight: ["transferring", "failed", "cancelled"],
  transferring: ["shadow-deploying", "failed", "cancelled"],
  "shadow-deploying": ["validating", "failed", "cancelled"],
  validating: ["cutting-over", "rolling-back", "failed", "cancelled"],
  "cutting-over": ["awaiting-confirmation", "rolling-back", "failed"],
  "awaiting-confirmation": ["completed", "rolling-back"],
  "rolling-back": ["failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function assertWorkloadMigrationTransition(
  from: WorkloadMigrationStatus,
  to: WorkloadMigrationStatus,
): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid workload migration transition: ${from} -> ${to}`);
  }
}
