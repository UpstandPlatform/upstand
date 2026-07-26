import { z } from "zod";

export const DockerRegistrySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  imagePrefix: z.string().nullable().optional(),
  registryUrl: z.string().nullable().optional(),
  serverId: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type DockerRegistry = z.infer<typeof DockerRegistrySchema>;

export interface CreateDockerRegistryDTO {
  id?: string;
  organizationId: string;
  name: string;
  username?: string | null;
  password?: string | null;
  imagePrefix?: string | null;
  registryUrl?: string | null;
  serverId?: string | null;
}
