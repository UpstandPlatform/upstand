import { z } from "zod";

export interface Schedule {
  id: string;
  resourceId: string | null;
  name: string;
  description: string | null;
  cronExpression: string;
  httpMethod: "GET" | "POST" | null;
  secretEnvVar: string | null;
  timezone: string;
  jobType: "command" | "deployment" | "backup" | "cron";
  serviceName: string | null;
  shellType: "bash" | "sh";
  source: "upstand.json" | "manual";
  backupScheduleId: string | null;
  command: string;
  enabled: boolean;
  lastRunAt: Date | null;
  lastRunStatus: "success" | "failed" | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateScheduleDTO = Omit<
  Schedule,
  | "createdAt"
  | "updatedAt"
  | "description"
  | "timezone"
  | "httpMethod"
  | "secretEnvVar"
  | "serviceName"
  | "shellType"
  | "source"
  | "backupScheduleId"
  | "lastRunAt"
  | "lastRunStatus"
> & {
  id?: string;
  description?: string | null;
  timezone?: string;
  httpMethod?: "GET" | "POST" | null;
  secretEnvVar?: string | null;
  serviceName?: string | null;
  shellType?: "bash" | "sh";
  source?: "upstand.json" | "manual";
  backupScheduleId?: string | null;
  lastRunAt?: Date | null;
  lastRunStatus?: "success" | "failed" | null;
};

export interface ScheduleLog {
  id: string;
  scheduleId: string;
  resourceId: string | null;
  status: "success" | "failed";
  statusCode: number | null;
  durationMs: number;
  responseBody: string | null;
  errorMessage: string | null;
  executedAt: Date;
}

export type CreateScheduleLogDTO = Omit<ScheduleLog, "id" | "executedAt"> & {
  id?: string;
  executedAt?: Date;
};

const ScheduleNameSchema = z.string().trim().min(1).max(120);
const ScheduleCronSchema = z.string().trim().min(1).max(120);
export const ScheduleCommandSchema = z.string().trim().min(1).max(2048);
export const ScheduleJobTypeSchema = z.enum([
  "command",
  "deployment",
  "backup",
  "cron",
]);
export const ScheduleShellTypeSchema = z.enum(["bash", "sh"]);
export const ScheduleSourceSchema = z.enum(["upstand.json", "manual"]);

export const GetSchedulesInputSchema = z.object({
  resourceId: z.string().min(1),
});

export type GetSchedulesInput = z.infer<typeof GetSchedulesInputSchema>;

export const GetScheduleLogsInputSchema = z.object({
  scheduleId: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
});

export type GetScheduleLogsInput = z.infer<typeof GetScheduleLogsInputSchema>;

export const CreateScheduleInputSchema = z
  .object({
    resourceId: z.string().min(1),
    name: ScheduleNameSchema,
    description: z.string().trim().max(500).optional().nullable(),
    cronExpression: ScheduleCronSchema,
    httpMethod: z.enum(["GET", "POST"]).optional().nullable(),
    secretEnvVar: z
      .string()
      .trim()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Invalid secret environment variable")
      .optional()
      .nullable(),
    timezone: z.string().trim().default("UTC").optional(),
    jobType: ScheduleJobTypeSchema.default("command"),
    serviceName: z.string().trim().optional().nullable(),
    shellType: ScheduleShellTypeSchema.default("bash").optional(),
    source: ScheduleSourceSchema.default("manual").optional(),
    backupScheduleId: z.string().min(1).optional().nullable(),
    command: z.string().trim().max(2048).default(""),
    enabled: z.boolean().default(true),
  })
  .superRefine((input, ctx) => {
    if (
      input.jobType === "command" &&
      !ScheduleCommandSchema.safeParse(input.command).success
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["command"],
        message: "A command is required for command schedules",
      });
    }
    if (
      input.jobType === "cron" &&
      !ScheduleCommandSchema.safeParse(input.command).success
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["command"],
        message: "A path (e.g. /api/cron) is required for HTTP cron schedules",
      });
    }
    if (input.jobType === "backup" && !input.backupScheduleId) {
      ctx.addIssue({
        code: "custom",
        path: ["backupScheduleId"],
        message: "Choose a backup schedule",
      });
    }
  });

export type CreateScheduleInput = z.infer<typeof CreateScheduleInputSchema>;

export const UpdateScheduleInputSchema = z.object({
  id: z.string().min(1),
  name: ScheduleNameSchema.optional(),
  description: z.string().trim().max(500).nullable().optional(),
  cronExpression: ScheduleCronSchema.optional(),
  httpMethod: z.enum(["GET", "POST"]).optional().nullable(),
  secretEnvVar: z
    .string()
    .trim()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Invalid secret environment variable")
    .optional()
    .nullable(),
  timezone: z.string().trim().optional(),
  jobType: ScheduleJobTypeSchema.optional(),
  serviceName: z.string().trim().nullable().optional(),
  shellType: ScheduleShellTypeSchema.optional(),
  source: ScheduleSourceSchema.optional(),
  backupScheduleId: z.string().min(1).nullable().optional(),
  command: ScheduleCommandSchema.optional(),
  enabled: z.boolean().optional(),
});

export type UpdateScheduleInput = z.infer<typeof UpdateScheduleInputSchema>;

export const DeleteScheduleInputSchema = z.object({
  id: z.string().min(1),
});

export type DeleteScheduleInput = z.infer<typeof DeleteScheduleInputSchema>;

export const GetCronJobObservabilityInputSchema = z.object({
  organizationId: z.string().min(1),
  timespan: z.enum(["24h", "7d", "30d"]).default("30d"),
  status: z.enum(["all", "success", "failed"]).default("all").optional(),
  resourceId: z.string().optional(),
  search: z.string().optional(),
});

export type GetCronJobObservabilityInput = z.infer<
  typeof GetCronJobObservabilityInputSchema
>;

export interface CronJobObservabilityItem {
  id: string;
  resourceId: string | null;
  resourceName: string | null;
  name: string;
  description: string | null;
  command: string;
  cronExpression: string;
  timezone: string;
  jobType: "command" | "deployment" | "backup" | "cron";
  source: "upstand.json" | "manual";
  enabled: boolean;
  invocationsCount: number;
  p75DurationMs: number;
  successCount: number;
  failedCount: number;
  lastRunAt: Date | null;
  lastRunStatus: "success" | "failed" | null;
}

export interface CronJobObservabilityResult {
  timespan: "24h" | "7d" | "30d";
  totalJobs: number;
  totalInvocations: number;
  p75DurationMs: number;
  successRate: number;
  items: CronJobObservabilityItem[];
}
