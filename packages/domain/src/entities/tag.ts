import { z } from "zod";

export const DEFAULT_TAG_COLOR = "#6366f1";
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const TagColorSchema = z
  .string()
  .regex(
    HEX_COLOR_PATTERN,
    "Color must be a valid 6-digit hex color (for example, #6366f1)",
  );

export const TagSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string().min(1).max(64),
  color: TagColorSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Tag = z.infer<typeof TagSchema>;
export type TagColor = z.infer<typeof TagColorSchema>;

export interface CreateTagDTO {
  id?: string;
  organizationId: string;
  name: string;
  color?: TagColor;
}

export interface ITagRepository {
  findById(id: string): Promise<Tag | null>;
  findByOrganizationId(organizationId: string): Promise<Tag[]>;
  findByResourceId(resourceId: string): Promise<Tag[]>;
  create(data: CreateTagDTO): Promise<Tag>;
  updateById(id: string, patch: Partial<CreateTagDTO>): Promise<Tag | null>;
  deleteById(id: string): Promise<boolean>;
  attachToResource(resourceId: string, tagId: string): Promise<void>;
  detachFromResource(resourceId: string, tagId: string): Promise<void>;
}
