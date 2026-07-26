import { z } from "zod";

export const ResourcePreviewFieldsSchema = z.object({
  isPreviewDeploymentsActive: z.boolean().optional(),
  previewLimit: z.coerce.number().int().min(1).max(100).optional(),
  previewWildcard: z.string().trim().min(1).max(253).nullable().optional(),
  previewHttps: z.boolean().optional(),
  previewPort: z.coerce.number().int().min(1).max(65535).optional(),
});
