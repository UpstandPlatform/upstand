import { z } from "zod";

export const GitProviderSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  provider: z.string(),
  config: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type GitProvider = z.infer<typeof GitProviderSchema>;

export interface CreateGitProviderDTO {
  id?: string;
  organizationId: string;
  name: string;
  provider: string;
  config: string;
}
