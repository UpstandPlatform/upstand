import { TRPCError } from "@trpc/server";
import {
  API_KEY_CONFIG_ID,
  API_KEY_PRESETS,
  ApiKeyPermissionsSchema,
  ApiKeyPresetSchema,
  apiKeyPermissionsToStatements,
} from "@upstand/domain";
import { z } from "zod";
import { auth } from "../auth";
import { router, twoFactorVerifiedProcedure } from "../index";
import { checkPermission } from "../permissions";

const organizationInput = z.object({ organizationId: z.string().min(1) });
const headersFrom = (ctx: { honoContext: { req: { raw: Request } } }) =>
  ctx.honoContext.req.raw.headers;

const permissionsInputShape = z.object({
  preset: ApiKeyPresetSchema.optional(),
  permissions: ApiKeyPermissionsSchema.optional(),
});

const permissionsInput = permissionsInputShape.superRefine((value, ctx) => {
  if (!value.preset && !value.permissions) {
    ctx.addIssue({
      code: "custom",
      path: ["permissions"],
      message: "Choose a permission preset or define advanced permissions.",
    });
  }
});

function resolvePermissions(input: z.infer<typeof permissionsInputShape>) {
  return apiKeyPermissionsToStatements(
    input.permissions ?? API_KEY_PRESETS[input.preset ?? "read-only"],
  );
}

type ApiKeyRecord = {
  id: string;
  configId: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  referenceId: string;
  permissions: Record<string, string[]> | null;
  metadata: Record<string, unknown> | null;
  enabled: boolean;
  rateLimitEnabled: boolean;
  rateLimitTimeWindow: number | null;
  rateLimitMax: number | null;
  remaining: number | null;
  lastRequest: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapKey(key: ApiKeyRecord) {
  return {
    id: key.id,
    configId: key.configId,
    name: key.name,
    start: key.start,
    prefix: key.prefix,
    organizationId: key.referenceId,
    permissions: key.permissions,
    metadata: key.metadata,
    enabled: key.enabled,
    rateLimitEnabled: key.rateLimitEnabled,
    rateLimitTimeWindow: key.rateLimitTimeWindow,
    rateLimitMax: key.rateLimitMax,
    remaining: key.remaining,
    lastRequest: key.lastRequest,
    expiresAt: key.expiresAt,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
  };
}

async function requireKeyAdmin(userId: string, organizationId: string) {
  return checkPermission(userId, organizationId, "api_key:manage");
}

export const apiKeyRouter = router({
  list: twoFactorVerifiedProcedure
    .input(organizationInput)
    .query(async ({ ctx, input }) => {
      await requireKeyAdmin(ctx.session.user.id, input.organizationId);
      const result = await auth.api.listApiKeys({
        headers: headersFrom(ctx),
        query: {
          configId: API_KEY_CONFIG_ID,
          organizationId: input.organizationId,
        },
      });
      return { ...result, apiKeys: result.apiKeys.map(mapKey) };
    }),

  create: twoFactorVerifiedProcedure
    .input(
      organizationInput
        .extend({
          name: z.string().trim().min(1).max(120),
          expiresInDays: z
            .number()
            .int()
            .min(1)
            .max(365)
            .nullable()
            .default(90),
          rateLimitEnabled: z.boolean().default(true),
          rateLimitTimeWindowMs: z
            .number()
            .int()
            .min(60_000)
            .max(30 * 86_400_000)
            .default(3_600_000),
          rateLimitMax: z.number().int().min(1).max(100_000).default(1_000),
        })
        .and(permissionsInput),
    )
    .mutation(async ({ ctx, input }) => {
      await requireKeyAdmin(ctx.session.user.id, input.organizationId);
      try {
        const result = await auth.api.createApiKey({
          body: {
            configId: API_KEY_CONFIG_ID,
            organizationId: input.organizationId,
            userId: ctx.session.user.id,
            name: input.name,
            expiresIn:
              input.expiresInDays === null
                ? null
                : input.expiresInDays * 24 * 60 * 60,
            rateLimitEnabled: input.rateLimitEnabled,
            rateLimitTimeWindow: input.rateLimitTimeWindowMs,
            rateLimitMax: input.rateLimitMax,
            permissions: resolvePermissions(input),
            metadata: {
              createdBy: ctx.session.user.id,
              createdAt: new Date().toISOString(),
            },
          },
        });
        return { key: mapKey(result), secret: result.key };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Unable to create API key",
        });
      }
    }),

  update: twoFactorVerifiedProcedure
    .input(
      organizationInput
        .extend({
          keyId: z.string().min(1),
          name: z.string().trim().min(1).max(120).optional(),
          enabled: z.boolean().optional(),
          expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
          rateLimitEnabled: z.boolean().optional(),
          rateLimitTimeWindowMs: z
            .number()
            .int()
            .min(60_000)
            .max(30 * 86_400_000)
            .optional(),
          rateLimitMax: z.number().int().min(1).max(100_000).optional(),
        })
        .and(permissionsInputShape.partial()),
    )
    .mutation(async ({ ctx, input }) => {
      await requireKeyAdmin(ctx.session.user.id, input.organizationId);
      const result = await auth.api.updateApiKey({
        body: {
          configId: API_KEY_CONFIG_ID,
          keyId: input.keyId,
          userId: ctx.session.user.id,
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.expiresInDays === undefined
            ? {}
            : {
                expiresIn:
                  input.expiresInDays === null
                    ? null
                    : input.expiresInDays * 24 * 60 * 60,
              }),
          ...(input.rateLimitEnabled === undefined
            ? {}
            : { rateLimitEnabled: input.rateLimitEnabled }),
          ...(input.rateLimitTimeWindowMs === undefined
            ? {}
            : { rateLimitTimeWindow: input.rateLimitTimeWindowMs }),
          ...(input.rateLimitMax === undefined
            ? {}
            : { rateLimitMax: input.rateLimitMax }),
          ...(input.preset || input.permissions
            ? { permissions: resolvePermissions(input) }
            : {}),
        },
      });
      return mapKey(result);
    }),

  revoke: twoFactorVerifiedProcedure
    .input(organizationInput.extend({ keyId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireKeyAdmin(ctx.session.user.id, input.organizationId);
      await auth.api.deleteApiKey({
        headers: headersFrom(ctx),
        body: { configId: API_KEY_CONFIG_ID, keyId: input.keyId },
      });
      return { revoked: true };
    }),
});
