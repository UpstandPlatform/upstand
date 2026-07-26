import { z } from "zod";

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
