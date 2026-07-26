import { z } from "zod";

const RepositoryRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      value !== "/" &&
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[A-Za-z]:[\\/]/.test(value) &&
      !value.split(/[\\/]+/).includes(".."),
    "Path must be relative to the repository and must not contain '..'",
  );

const SecretEnvironmentVariableSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    "Secret environment variable must be a valid environment variable name",
  );

function validateCronExpression(expr: string): boolean {
  if (!expr || typeof expr !== "string") return false;
  const parts = expr.trim().split(/\s+/);
  return parts.length >= 5 && parts.length <= 6;
}

export const UpstandCronConfigSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().optional(),
    // HTTP Cron properties
    path: z
      .string()
      .trim()
      .min(1)
      .refine((val) => val.startsWith("/"), {
        message: "Cron path must start with '/'",
      })
      .optional(),
    method: z.enum(["GET", "POST"]).default("GET").optional(),
    // Never put the secret value in source control. The value is read from
    // the encrypted resource environment at execution time.
    secretEnvVar: SecretEnvironmentVariableSchema.optional(),

    // Command Schedule properties
    command: z.string().trim().min(1).optional(),
    shellType: z.enum(["bash", "sh"]).default("bash").optional(),
    serviceName: z.string().trim().optional(),

    // Shared schedule properties
    schedule: z
      .string()
      .trim()
      .min(1, "Schedule expression is required")
      .refine(validateCronExpression, {
        message: "Invalid cron expression",
      }),
    timezone: z.string().trim().default("UTC").optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.path && !data.command) {
      ctx.addIssue({
        code: "custom",
        path: ["path"],
        message:
          "Cron item must specify either a 'path' (HTTP cron) or a 'command' (Script schedule)",
      });
    }
    if (data.path && data.command) {
      ctx.addIssue({
        code: "custom",
        path: ["command"],
        message: "Cron item cannot specify both 'path' and 'command'",
      });
    }
    if (data.secretEnvVar && !data.path) {
      ctx.addIssue({
        code: "custom",
        path: ["secretEnvVar"],
        message: "secretEnvVar is only valid for HTTP cron items",
      });
    }
  })
  .strict();

export type UpstandCronConfig = z.infer<typeof UpstandCronConfigSchema>;

export const UpstandBuildConfigSchema = z
  .object({
    type: z
      .enum([
        "dockerfile",
        "railpack",
        "nixpacks",
        "heroku-buildpacks",
        "paketo-buildpacks",
        "static",
      ])
      .optional(),
    buildPath: RepositoryRelativePathSchema.optional(),
    dockerfilePath: RepositoryRelativePathSchema.optional(),
    dockerContextPath: RepositoryRelativePathSchema.optional(),
    publishDirectory: RepositoryRelativePathSchema.optional(),
    dockerBuildStage: z.string().trim().min(1).optional(),
    dockerBuildArgs: z.record(z.string(), z.string()).optional(),
    dockerNoCache: z.boolean().optional(),
    watchPaths: z
      .union([z.string().trim(), z.array(z.string().trim())])
      .optional(),
  })
  .strict();

export type UpstandBuildConfig = z.infer<typeof UpstandBuildConfigSchema>;

export const UpstandRuntimeConfigSchema = z
  .object({
    command: z
      .union([z.string().trim(), z.array(z.string().trim())])
      .optional(),
    args: z.array(z.string()).optional(),
    workingDir: z.string().trim().optional(),
    cpuLimit: z.number().positive().max(1024).optional(),
    cpuReservation: z.number().positive().max(1024).optional(),
    memoryLimitMb: z.number().int().positive().max(1_048_576).optional(),
    memoryReservationMb: z.number().int().positive().max(1_048_576).optional(),
    replicas: z.number().int().min(0).max(1000).optional(),
    restartPolicy: z
      .object({
        condition: z.enum(["none", "on-failure", "any"]).optional(),
        maxAttempts: z.number().int().min(0).max(1000).optional(),
        delaySeconds: z.number().int().min(0).max(86400).optional(),
      })
      .optional(),
    updateConfig: z
      .object({
        parallelism: z.number().int().min(0).max(1000).optional(),
        order: z.enum(["stop-first", "start-first"]).optional(),
      })
      .optional(),
  })
  .strict();

export type UpstandRuntimeConfig = z.infer<typeof UpstandRuntimeConfigSchema>;

export const UpstandConfigSchema = z
  .object({
    $schema: z.string().optional(),
    build: UpstandBuildConfigSchema.optional(),
    runtime: UpstandRuntimeConfigSchema.optional(),
    resources: UpstandRuntimeConfigSchema.optional(),
    crons: z.array(UpstandCronConfigSchema).max(100).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.runtime && data.resources) {
      ctx.addIssue({
        code: "custom",
        path: ["resources"],
        message: "Use either 'runtime' or 'resources', not both",
      });
    }
  });

export type UpstandConfig = z.infer<typeof UpstandConfigSchema>;

export interface ParseUpstandConfigSuccess {
  success: true;
  data: UpstandConfig;
}

export interface ParseUpstandConfigError {
  success: false;
  error: string;
  issues: z.ZodIssue[];
}

export type ParseUpstandConfigResult =
  | ParseUpstandConfigSuccess
  | ParseUpstandConfigError;

export function parseUpstandConfig(input: unknown): ParseUpstandConfigResult {
  let objectToValidate = input;
  if (typeof input === "string") {
    try {
      objectToValidate = JSON.parse(input);
    } catch (error: unknown) {
      const message: string =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Invalid JSON syntax: ${message}`,
        issues: [],
      };
    }
  }

  const result = UpstandConfigSchema.safeParse(objectToValidate);
  if (!result.success) {
    const formattedError = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    return {
      success: false,
      error: formattedError,
      issues: result.error.issues,
    };
  }

  return {
    success: true,
    data: result.data,
  };
}
