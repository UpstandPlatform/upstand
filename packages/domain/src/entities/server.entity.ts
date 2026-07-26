import { z } from "zod";

export const ServerTypeSchema = z.enum(["deploy", "build", "database"]);
export type ServerType = z.infer<typeof ServerTypeSchema>;

export const ServerStatusSchema = z.enum([
  "idle",
  "setting_up",
  "ready",
  "failed",
]);
export type ServerStatus = z.infer<typeof ServerStatusSchema>;

export const ServerSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  serverType: ServerTypeSchema,
  sshKeyId: z.string().nullable().optional(),
  sshHostKeyFingerprint: z.string().nullable().optional(),
  ipAddress: z.string(),
  port: z.number(),
  username: z.string(),
  enableDockerCleanup: z.boolean(),
  status: ServerStatusSchema,
  setupError: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Server = z.infer<typeof ServerSchema>;

export interface CreateServerDTO {
  id?: string;
  organizationId: string;
  name: string;
  description?: string | null;
  serverType: ServerType;
  sshKeyId?: string | null;
  sshHostKeyFingerprint?: string | null;
  ipAddress: string;
  port: number;
  username: string;
  enableDockerCleanup?: boolean;
  status?: ServerStatus;
  setupError?: string | null;
}
