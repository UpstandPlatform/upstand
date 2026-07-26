import { z } from "zod";

export const MonitoringSettingsSchema = z.object({
  serverId: z.string(),
  token: z.string(),
  cpuThreshold: z.number(),
  memoryThreshold: z.number(),
  alertEmail: z.string().nullable().optional(),
  updatedAt: z.date(),
});

export type MonitoringSettings = z.infer<typeof MonitoringSettingsSchema>;

export interface UpsertMonitoringSettingsDTO {
  serverId: string;
  token?: string;
  cpuThreshold?: number;
  memoryThreshold?: number;
  alertEmail?: string | null;
}
