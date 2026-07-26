import { z } from "zod";

export const EnvironmentSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  parentEnvironmentId: z.string().nullable().optional(),
  inheritsVariables: z.boolean().default(false),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  isDefault: z.boolean(),
  isProtected: z.boolean(),
  resourceCount: z.number().int().nonnegative(),
  /**
   * Encrypted JSON string of project-level environment variables. Absent when
   * the environment has no shared variables configured yet (lazy creation).
   */
  envVars: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

export interface CreateEnvironmentDTO {
  id?: string;
  projectId: string;
  parentEnvironmentId?: string | null;
  inheritsVariables?: boolean;
  name: string;
  slug: string;
  description?: string | null;
  isDefault?: boolean;
  isProtected?: boolean;
  resourceCount?: number;
}

export interface UpdateEnvironmentDTO {
  name?: string;
  description?: string | null;
  parentEnvironmentId?: string | null;
  inheritsVariables?: boolean;
  /** Serialised (encrypted) env vars JSON string, as returned by serializeResourceEnvironmentVariables. */
  envVars?: string;
}
