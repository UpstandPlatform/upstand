import { z } from "zod";
import {
  BuildLocationSchema,
  DataOwnershipSchema,
  type DeploymentPlan,
  DeploymentPlanSchema,
  DeployTargetSchema,
  ExecutionRuntimeSchema,
} from "./deployment-plan";

export const DeploymentStatusSchema = z.enum([
  "queued",
  "running",
  "retrying",
  "success",
  "failed",
  "stale",
  "cancelled",
]);
export type DeploymentStatus = z.infer<typeof DeploymentStatusSchema>;

export const DeploymentSchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  status: DeploymentStatusSchema,
  title: z.string(),
  logs: z.string(),
  serverId: z.string().nullable().optional(),
  serverName: z.string().nullable().optional(),
  sourceRevision: z.string().nullable().optional(),
  deploymentPlan: DeploymentPlanSchema.nullable().optional(),
  deployTarget: DeployTargetSchema.nullable().optional(),
  executionRuntime: ExecutionRuntimeSchema.nullable().optional(),
  buildLocation: BuildLocationSchema.nullable().optional(),
  dataOwnership: DataOwnershipSchema.nullable().optional(),
  artifactDigest: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/)
    .nullable()
    .optional(),
  configurationVersion: z.string().nullable().optional(),
  executionToken: z.string().nullable().optional(),
  attempt: z.number().int().nonnegative().default(0),
  maxAttempts: z.number().int().positive().default(1),
  heartbeatAt: z.date().nullable().optional(),
  retryAt: z.date().nullable().optional(),
  lastError: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Deployment = z.infer<typeof DeploymentSchema>;

export interface CreateDeploymentDTO {
  id?: string;
  resourceId: string;
  status: string;
  title: string;
  logs?: string;
  serverId?: string | null;
  serverName?: string | null;
  sourceRevision?: string | null;
  deploymentPlan?: DeploymentPlan | null;
  deployTarget?: Deployment["deployTarget"];
  executionRuntime?: Deployment["executionRuntime"];
  buildLocation?: Deployment["buildLocation"];
  dataOwnership?: Deployment["dataOwnership"];
  artifactDigest?: string | null;
  configurationVersion?: string | null;
  maxAttempts?: number;
}

export interface UpdateDeploymentDTO {
  status?: DeploymentStatus;
  logs?: string;
  executionToken?: string | null;
  serverId?: string | null;
  serverName?: string | null;
  attempt?: number;
  maxAttempts?: number;
  heartbeatAt?: Date | null;
  retryAt?: Date | null;
  lastError?: string | null;
}
