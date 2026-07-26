import { z } from "zod";

export const ServerBuildSettingsSchema = z.object({
  id: z.string(),
  hostname: z.string(),
  ip: z.string(),
  concurrency: z.number().int().min(1),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ServerBuildSettings = z.infer<typeof ServerBuildSettingsSchema>;

export interface CreateServerBuildSettingsDTO {
  id: string;
  hostname: string;
  ip: string;
  concurrency?: number;
}

export interface UpdateServerBuildSettingsDTO {
  hostname?: string;
  ip?: string;
  concurrency?: number;
}
