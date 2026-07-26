import { z } from "zod";

export const BackupKindSchema = z.enum(["database", "volume", "web-server"]);
export type BackupKind = z.infer<typeof BackupKindSchema>;

export const BackupDatabaseEngineSchema = z.enum([
  "postgres",
  "mysql",
  "mariadb",
  "mongodb",
  "libsql",
  "redis",
]);
export type BackupDatabaseEngine = z.infer<typeof BackupDatabaseEngineSchema>;

export const BackupRunStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export type BackupRunStatus = z.infer<typeof BackupRunStatusSchema>;

export const BackupScheduleSchema = z.object({
  id: z.string(),
  resourceId: z.string().nullable(),
  organizationId: z.string(),
  destinationId: z.string(),
  name: z.string(),
  kind: BackupKindSchema,
  cronExpression: z.string(),
  timezone: z.string(),
  prefix: z.string(),
  retentionCount: z.number().int().positive().nullable(),
  enabled: z.boolean(),
  databaseName: z.string().nullable(),
  databaseEngine: BackupDatabaseEngineSchema.nullable(),
  serviceName: z.string().nullable(),
  volumeName: z.string().nullable(),
  stopService: z.boolean(),
  encryptedConfiguration: z.string().nullable(),
  pointInTimeRecovery: z.boolean(),
  restoreVerification: z.boolean(),
  replicaCount: z.number().int().nonnegative(),
  failoverEnabled: z.boolean(),
  migrationCommand: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type BackupSchedule = z.infer<typeof BackupScheduleSchema>;

export const BackupRunSchema = z.object({
  id: z.string(),
  scheduleId: z.string(),
  resourceId: z.string().nullable(),
  organizationId: z.string(),
  destinationId: z.string(),
  kind: BackupKindSchema,
  status: BackupRunStatusSchema,
  fileKey: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  verificationStatus: z.string().nullable(),
  verifiedAt: z.date().nullable(),
  restoreTestedAt: z.date().nullable(),
  recoveryPoint: z.string().nullable(),
});
export type BackupRun = z.infer<typeof BackupRunSchema>;

export const CreateBackupScheduleInputObjectSchema = z.object({
  resourceId: z.string().min(1),
  destinationId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  kind: BackupKindSchema,
  cronExpression: z.string().trim().min(1).max(120),
  timezone: z.string().trim().min(1).max(120).default("UTC"),
  prefix: z
    .string()
    .trim()
    .max(512)
    .refine(
      (value) => !value.split("/").includes(".."),
      "Prefix cannot contain '..'",
    ),
  retentionCount: z.number().int().positive().max(3650).nullable().optional(),
  enabled: z.boolean().default(true),
  databaseName: z.string().trim().min(1).max(128).optional(),
  databaseEngine: BackupDatabaseEngineSchema.optional(),
  serviceName: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/)
    .optional(),
  volumeName: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/)
    .optional(),
  stopService: z.boolean().default(false),
  pointInTimeRecovery: z.boolean().optional(),
  restoreVerification: z.boolean().optional(),
  replicaCount: z.number().int().min(0).max(9).optional(),
  failoverEnabled: z.boolean().optional(),
  migrationCommand: z.string().trim().max(4096).optional(),
  sourceCredentials: z
    .object({
      databaseUser: z.string().trim().min(1).max(255),
      databasePassword: z.string().min(1).max(1024),
    })
    .optional(),
});

export const CreateBackupScheduleInputSchema =
  CreateBackupScheduleInputObjectSchema.superRefine((input, ctx) => {
    if (input.kind === "database") {
      if (
        !input.databaseName &&
        input.databaseEngine !== "redis" &&
        input.databaseEngine !== "libsql"
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["databaseName"],
          message: "Database name is required for a database backup",
        });
      }
      if (!input.databaseEngine) {
        ctx.addIssue({
          code: "custom",
          path: ["databaseEngine"],
          message: "Database engine is required for a database backup",
        });
      }
    }
    if (input.kind === "volume" && !input.volumeName) {
      ctx.addIssue({
        code: "custom",
        path: ["volumeName"],
        message: "Volume name is required for a volume backup",
      });
    }
    if (input.pointInTimeRecovery && input.databaseEngine !== "postgres") {
      ctx.addIssue({
        code: "custom",
        path: ["pointInTimeRecovery"],
        message: "Point-in-time recovery currently requires PostgreSQL",
      });
    }
    if ((input.replicaCount ?? 0) > 0 && input.databaseEngine !== "postgres") {
      ctx.addIssue({
        code: "custom",
        path: ["replicaCount"],
        message: "Managed database replicas currently require PostgreSQL",
      });
    }
    if (
      input.failoverEnabled &&
      (input.databaseEngine !== "postgres" || (input.replicaCount ?? 0) < 1)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["failoverEnabled"],
        message: "Failover requires at least one PostgreSQL replica",
      });
    }
  });
export type CreateBackupScheduleInput = z.infer<
  typeof CreateBackupScheduleInputSchema
>;

export const CreateWebServerBackupScheduleInputSchema = z.object({
  organizationId: z.string().min(1),
  destinationId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  cronExpression: z.string().trim().min(1).max(120),
  timezone: z.string().trim().min(1).max(120).default("UTC"),
  prefix: z
    .string()
    .trim()
    .max(512)
    .refine(
      (value) => !value.split("/").includes(".."),
      "Prefix cannot contain '..'",
    ),
  retentionCount: z.number().int().positive().max(3650).nullable().optional(),
  enabled: z.boolean().default(true),
});
export type CreateWebServerBackupScheduleInput = z.infer<
  typeof CreateWebServerBackupScheduleInputSchema
>;

export const UpdateBackupScheduleInputSchema =
  CreateBackupScheduleInputObjectSchema.partial().extend({
    id: z.string().min(1),
  });
export type UpdateBackupScheduleInput = z.infer<
  typeof UpdateBackupScheduleInputSchema
>;

export interface CreateBackupScheduleDTO {
  id: string;
  resourceId: string | null;
  organizationId: string;
  destinationId: string;
  name: string;
  kind: BackupKind;
  cronExpression: string;
  timezone: string;
  prefix: string;
  retentionCount?: number | null;
  enabled?: boolean;
  databaseName?: string | null;
  databaseEngine?: BackupDatabaseEngine | null;
  serviceName?: string | null;
  volumeName?: string | null;
  stopService?: boolean;
  pointInTimeRecovery?: boolean;
  restoreVerification?: boolean;
  replicaCount?: number;
  failoverEnabled?: boolean;
  migrationCommand?: string | null;
  encryptedConfiguration?: string | null;
}

export interface CreateBackupRunDTO {
  id: string;
  scheduleId: string;
  resourceId: string | null;
  organizationId: string;
  destinationId: string;
  kind: BackupKind;
  status?: BackupRunStatus;
  fileKey?: string | null;
  error?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  verificationStatus?: string | null;
  verifiedAt?: Date | null;
  restoreTestedAt?: Date | null;
  recoveryPoint?: string | null;
}

export type BackupScheduleView = Omit<BackupSchedule, "encryptedConfiguration">;

export function toBackupScheduleView(
  schedule: BackupSchedule,
): BackupScheduleView {
  const { encryptedConfiguration: _encryptedConfiguration, ...view } = schedule;
  return view;
}
