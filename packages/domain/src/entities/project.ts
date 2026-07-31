import { z } from "zod";
import { EntityIconSchema } from "./icon";

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  organizationId: z.string(),
  isApp: z.boolean().optional(),
  appCatalogId: z.string().nullable().optional(),
  appVersion: z.string().nullable().optional(),
  appVerified: z.boolean().nullable().optional(),
  icon: EntityIconSchema,
  archivedAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Project = z.infer<typeof ProjectSchema>;

export interface CreateProjectDTO {
  id?: string;
  name: string;
  description?: string | null;
  organizationId: string;
  isApp?: boolean;
  appCatalogId?: string | null;
  appVersion?: string | null;
  appVerified?: boolean | null;
  icon?: string | null;
  archivedAt?: Date | null;
}

export interface UpdateProjectDTO {
  name?: string;
  description?: string | null;
  icon?: string | null;
  archived?: boolean;
  isApp?: boolean;
  appCatalogId?: string | null;
  appVersion?: string | null;
  appVerified?: boolean | null;
}
