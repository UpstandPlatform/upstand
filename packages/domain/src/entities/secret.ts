import { z } from "zod";

export const SecretScopeTypeSchema = z.enum(["environment", "resource"]);
export type SecretScopeType = z.infer<typeof SecretScopeTypeSchema>;

export const SecretVersionSchema = z.object({
  id: z.string(),
  scopeType: SecretScopeTypeSchema,
  scopeId: z.string(),
  version: z.number().int().positive(),
  source: z.string(),
  createdBy: z.string().nullable().optional(),
  createdAt: z.date(),
});
export type SecretVersion = z.infer<typeof SecretVersionSchema>;

export const SecretProviderTypeSchema = z.enum([
  "vault",
  "aws-secrets-manager",
  "onepassword",
]);
export type SecretProviderType = z.infer<typeof SecretProviderTypeSchema>;

export const SecretProviderSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  provider: SecretProviderTypeSchema,
  enabled: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type SecretProvider = z.infer<typeof SecretProviderSchema>;

export const SecretRotationScheduleSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  scopeType: SecretScopeTypeSchema,
  scopeId: z.string(),
  keys: z.array(z.string()),
  intervalHours: z.number().int().min(1),
  valueLength: z.number().int().min(16).max(128),
  enabled: z.boolean(),
  lastRotatedAt: z.date().nullable(),
  rotationClaimedUntil: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type SecretRotationSchedule = z.infer<
  typeof SecretRotationScheduleSchema
>;
