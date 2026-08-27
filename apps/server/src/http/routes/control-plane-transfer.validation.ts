import { z } from "zod";

const MAX_TRANSFER_PASSPHRASE_LENGTH = 256;

/**
 * Keep passphrases bounded before they reach the memory-hard KDF, while
 * preserving intentional leading/trailing characters for export/import
 * round-trips.
 */
export const transferPassphraseSchema = z
  .string()
  .min(12)
  .max(MAX_TRANSFER_PASSPHRASE_LENGTH)
  .refine((value) => value.trim().length > 0);

export const controlPlaneOwnerRepairRequestSchema = z
  .object({
    confirmation: z.literal("REPAIR_INSTANCE_OWNERSHIP"),
  })
  .strict();

export const controlPlaneOwnerTransferRequestSchema = z
  .object({
    newOwnerUserId: z.string().trim().min(1).max(256),
    confirmation: z.literal("TRANSFER_INSTANCE_OWNERSHIP"),
  })
  .strict();

export const controlPlaneExportRequestSchema = z
  .object({
    includeSecrets: z.boolean().default(false),
    passphrase: transferPassphraseSchema.optional(),
  })
  .strict();

export function parseTransferPassphrase(
  value: string | undefined,
): { success: true; data: string | undefined } | { success: false } {
  if (value === undefined) return { success: true, data: undefined };
  const parsed = transferPassphraseSchema.safeParse(value);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false };
}
