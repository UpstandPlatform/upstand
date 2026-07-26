import { z } from "zod";

export const tagSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  color: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export const tagsSchema = z.array(tagSchema);
export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(64),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#6366f1"),
});
export const updateTagSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(64).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export const deleteTagSchema = z.object({ id: z.string().min(1) });
export const resourceTagSchema = z.object({
  resourceId: z.string().min(1),
  tagId: z.string().min(1),
});
export const resourceTagMutationSchema = z.object({
  assigned: z.boolean().optional(),
  removed: z.boolean().optional(),
});
