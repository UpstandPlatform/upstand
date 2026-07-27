import { z } from "zod";

/**
 * Provider IDs are administrator-facing labels, not opaque URLs. Keep them
 * predictable so they can safely be displayed and used by integrations.
 */
export const ScimProviderIdSchema = z
  .string()
  .trim()
  .min(1, "Provider ID is required")
  .max(120, "Provider ID must be 120 characters or fewer")
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?$/,
    "Provider ID may contain only letters, numbers, dots, underscores, colons, and hyphens",
  );
