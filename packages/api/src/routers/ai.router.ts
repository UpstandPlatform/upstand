import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { AI_FEATURES, AI_PROVIDERS, type AIProvider } from "@upstand/domain";
import { env } from "@upstand/env/server";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import { redis } from "@upstand/redis";
import { AIRepositoryToken } from "@upstand/repositories/tokens";
import { z } from "zod";
import { getUpGalProviderIdentity } from "../ai/provider";
import {
  generateComposeTemplate,
  getConversationForUser,
  listConversations,
  listProviderModels,
  testUpGalProvider,
} from "../ai/upgal";
import { UpGalError } from "../ai/upgal-errors";
import { UpGalPageContextSchema } from "../ai/upgal-page-context";
import {
  reserveUpGalDailyRunTokenAndCostBudget,
  upGalConservativeCostPerMillionTokensUsd,
  upGalCostCentsForTokens,
} from "../ai-budget";
import {
  protectedProcedure,
  router,
  twoFactorVerifiedProcedure,
} from "../index";
import { checkPermission } from "../permissions";

// ── Shared input schemas ──────────────────────────────────────────────────────

const organizationInput = z.object({ organizationId: z.string().min(1) });

const providerFormSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: z.enum(AI_PROVIDERS),
  model: z.string().min(1).max(160),
  apiKey: z.string().min(1).optional(),
  baseUrl: z.url().optional().or(z.literal("")),
  temperature: z.number().min(0).max(2).nullable().optional(),
  reasoningEnabled: z.boolean().default(false),
  maxOutputTokens: z.number().int().min(256).max(32_768).nullable().optional(),
});

async function enforceAiDailyBudget(
  organizationId: string,
  log: { error(error: unknown, context?: Record<string, unknown>): void },
  requestedTokens = 256,
  model?: { provider: AIProvider; modelId: string },
): Promise<void> {
  if (env.NODE_ENV === "test") return;

  const requestedCents = upGalCostCentsForTokens(
    requestedTokens,
    upGalConservativeCostPerMillionTokensUsd(
      env.UPGAL_MAX_COST_PER_MILLION_TOKENS_USD,
      model,
    ),
  );
  let reservation: Awaited<
    ReturnType<typeof reserveUpGalDailyRunTokenAndCostBudget>
  >;
  try {
    reservation = await reserveUpGalDailyRunTokenAndCostBudget(
      redis,
      organizationId,
      env.UPGAL_DAILY_RUN_LIMIT,
      requestedTokens,
      env.UPGAL_DAILY_TOKEN_LIMIT,
      requestedCents,
      Math.round(env.UPGAL_DAILY_COST_LIMIT_USD * 100),
    );
  } catch (error) {
    log.error(error instanceof Error ? error : String(error), {
      message: "Unable to enforce UpGal daily budget",
      organizationId,
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "UpGal is temporarily unavailable",
    });
  }
  if (!reservation) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "UpGal daily organization run, token, or cost limit exceeded",
    });
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const aiRouter = router({
  // ── Template generation ──────────────────────────────────────────────────

  generateTemplate: twoFactorVerifiedProcedure
    .input(
      organizationInput.extend({
        request: z.string().trim().min(8).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ai:manage",
      );
      // Keep the complete request for validation. Removing only selected HTML
      // tags is not a safe sanitizer and could hide disallowed instructions.
      const sanitizedRequest = input.request.trim();
      const normalizedRequest = sanitizedRequest
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ");
      const dangerousPatterns = [
        /ignore\s+previous\s+instructions/i,
        /override\s+system\s+prompt/i,
        /bypass\s+safety\s+controls/i,
        /disregard\s+prior\s+directives/i,
        /system\s+prompt\s+override/i,
      ];
      for (const pattern of dangerousPatterns) {
        if (pattern.test(sanitizedRequest) || pattern.test(normalizedRequest)) {
          throw new UpGalError(
            "validation",
            "Prompt contains disallowed instruction patterns.",
          );
        }
      }
      const model = await getUpGalProviderIdentity(
        input.organizationId,
        ctx.scope.resolve(AIRepositoryToken),
        { feature: "template" },
      );
      await enforceAiDailyBudget(input.organizationId, ctx.log, 4096, model);
      return generateComposeTemplate(
        input.organizationId,
        ctx.scope,
        sanitizedRequest,
        ctx.log,
      );
    }),

  // ── Provider management ──────────────────────────────────────────────────

  listProviders: protectedProcedure
    .input(organizationInput)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ai:view",
      );
      const rows = await ctx.scope
        .resolve(AIRepositoryToken)
        .listProviderConfigs(input.organizationId);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        provider: row.provider,
        model: row.model,
        baseUrl: row.baseUrl,
        temperature: row.temperature,
        reasoningEnabled: row.reasoningEnabled,
        maxOutputTokens: row.maxOutputTokens,
        enabled: row.enabled,
        configured: Boolean(row.apiKeyCiphertext),
      }));
    }),

  addProvider: twoFactorVerifiedProcedure
    .input(organizationInput.merge(providerFormSchema))
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ai:manage",
      );
      const encrypted = input.apiKey ? encryptSecret(input.apiKey) : null;
      const created = await ctx.scope
        .resolve(AIRepositoryToken)
        .createProviderConfig({
          id: randomUUID(),
          organizationId: input.organizationId,
          name: input.name,
          provider: input.provider,
          model: input.model,
          baseUrl: input.baseUrl || null,
          temperature: input.temperature ?? null,
          reasoningEnabled: input.reasoningEnabled,
          maxOutputTokens: input.maxOutputTokens ?? null,
          secret: encrypted,
        });
      return {
        id: created.id,
        name: created.name,
        provider: created.provider,
        model: created.model,
        baseUrl: created.baseUrl,
        temperature: created.temperature,
        reasoningEnabled: created.reasoningEnabled,
        maxOutputTokens: created.maxOutputTokens,
        enabled: created.enabled,
        configured: Boolean(created.apiKeyCiphertext),
      };
    }),

  updateProvider: twoFactorVerifiedProcedure
    .input(
      organizationInput
        .extend({ id: z.string().min(1) })
        .merge(providerFormSchema),
    )
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ai:manage",
      );
      const repo = ctx.scope.resolve(AIRepositoryToken);
      const existing = await repo.findProviderConfigById(
        input.id,
        input.organizationId,
      );
      if (!existing) {
        throw new UpGalError("configuration", "Provider config not found.");
      }
      const encrypted = input.apiKey ? encryptSecret(input.apiKey) : undefined;
      await repo.updateProviderConfig(input.id, input.organizationId, {
        name: input.name,
        provider: input.provider,
        model: input.model,
        baseUrl: input.baseUrl || null,
        temperature: input.temperature,
        reasoningEnabled: input.reasoningEnabled,
        maxOutputTokens: input.maxOutputTokens,
        secret: encrypted,
      });
      return { updated: true };
    }),

  removeProvider: twoFactorVerifiedProcedure
    .input(organizationInput.extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ai:manage",
      );
      await ctx.scope
        .resolve(AIRepositoryToken)
        .deleteProviderConfig(input.id, input.organizationId);
      return { removed: true };
    }),

  testProvider: twoFactorVerifiedProcedure
    .input(
      organizationInput.extend({
        id: z.string().min(1).optional(),
        provider: z.enum(AI_PROVIDERS).optional(),
        model: z.string().min(1).max(160).optional(),
        baseUrl: z.url().optional().or(z.literal("")),
        apiKey: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ai:manage",
      );
      const model = await getUpGalProviderIdentity(
        input.organizationId,
        ctx.scope.resolve(AIRepositoryToken),
        {
          providerConfigId: input.id,
          provider: input.provider,
          model: input.model,
          baseUrl: input.baseUrl,
          apiKey: input.apiKey,
        },
      );
      await enforceAiDailyBudget(input.organizationId, ctx.log, 256, model);
      return testUpGalProvider(
        input.organizationId,
        ctx.scope,
        {
          providerConfigId: input.id,
          provider: input.provider,
          model: input.model,
          baseUrl: input.baseUrl,
          apiKey: input.apiKey,
        },
        ctx.log,
      );
    }),

  listModels: twoFactorVerifiedProcedure
    .input(
      organizationInput.extend({
        provider: z.enum(AI_PROVIDERS),
        search: z.string().trim().max(120).optional(),
        forceRefresh: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ai:manage",
      );
      await enforceAiDailyBudget(input.organizationId, ctx.log);
      return listProviderModels(input.organizationId, ctx.scope, {
        provider: input.provider,
        search: input.search,
        forceRefresh: input.forceRefresh,
      });
    }),

  // ── Feature assignments ──────────────────────────────────────────────────

  listFeatureAssignments: protectedProcedure
    .input(organizationInput)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ai:view",
      );
      return ctx.scope
        .resolve(AIRepositoryToken)
        .listFeatureAssignments(input.organizationId);
    }),

  saveFeatureAssignment: twoFactorVerifiedProcedure
    .input(
      organizationInput.extend({
        feature: z.enum(AI_FEATURES),
        providerConfigId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ai:manage",
      );
      // Verify the provider config belongs to this org before assigning
      const repo = ctx.scope.resolve(AIRepositoryToken);
      const config = await repo.findProviderConfigById(
        input.providerConfigId,
        input.organizationId,
      );
      if (!config) {
        throw new UpGalError("configuration", "Provider config not found.");
      }
      await repo.saveFeatureAssignment(
        input.organizationId,
        input.feature,
        input.providerConfigId,
      );
      return { saved: true };
    }),

  removeFeatureAssignment: twoFactorVerifiedProcedure
    .input(
      organizationInput.extend({
        feature: z.enum(AI_FEATURES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ai:manage",
      );
      await ctx.scope
        .resolve(AIRepositoryToken)
        .removeFeatureAssignment(input.organizationId, input.feature);
      return { removed: true };
    }),

  // ── Tavily Settings ──────────────────────────────────────────────────────

  getTavilySettings: protectedProcedure
    .input(organizationInput)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ai:view",
      );
      const row = await ctx.scope
        .resolve(AIRepositoryToken)
        .getTavilySettings(input.organizationId);
      return {
        enabled: row?.enabled ?? false,
        configured: Boolean(row?.apiKeyCiphertext),
        searchDepth: row?.searchDepth ?? "basic",
        includeAnswer: row?.includeAnswer ?? false,
        maxResults: row?.maxResults ?? 5,
        enableSearch: row?.enableSearch ?? true,
        enableExtract: row?.enableExtract ?? false,
        enableCrawl: row?.enableCrawl ?? false,
        enableMap: row?.enableMap ?? false,
      };
    }),

  saveTavilySettings: twoFactorVerifiedProcedure
    .input(
      organizationInput.extend({
        enabled: z.boolean(),
        apiKey: z.string().optional(),
        searchDepth: z.enum(["basic", "advanced"]).default("basic"),
        includeAnswer: z.boolean().default(false),
        maxResults: z.number().int().min(1).max(20).default(5),
        enableSearch: z.boolean().default(true),
        enableExtract: z.boolean().default(false),
        enableCrawl: z.boolean().default(false),
        enableMap: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ai:manage",
      );
      const secret = input.apiKey ? encryptSecret(input.apiKey) : undefined;
      await ctx.scope
        .resolve(AIRepositoryToken)
        .saveTavilySettings(input.organizationId, {
          enabled: input.enabled,
          searchDepth: input.searchDepth,
          includeAnswer: input.includeAnswer,
          maxResults: input.maxResults,
          enableSearch: input.enableSearch,
          enableExtract: input.enableExtract,
          enableCrawl: input.enableCrawl,
          enableMap: input.enableMap,
          secret,
        });
      return { saved: true };
    }),

  // ── Conversations ────────────────────────────────────────────────────────

  conversations: protectedProcedure
    .input(organizationInput)
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ai:view",
      );
      return listConversations(
        input.organizationId,
        ctx.session.user.id,
        ctx.scope.resolve(AIRepositoryToken),
      );
    }),

  createConversation: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        context: z
          .object({
            page: UpGalPageContextSchema,
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ai:view",
      );
      const id = randomUUID();
      await ctx.scope.resolve(AIRepositoryToken).createConversation({
        id,
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
        context: input.context ?? {},
      });
      return { id };
    }),

  getConversation: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        conversationId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ai:view",
      );
      const conversation = await getConversationForUser(
        input.conversationId,
        input.organizationId,
        ctx.session.user.id,
        ctx.scope.resolve(AIRepositoryToken),
      );
      if (!conversation) return null;
      const messages = await ctx.scope
        .resolve(AIRepositoryToken)
        .listMessages(conversation.id);
      return { conversation, messages };
    }),

  deleteConversation: twoFactorVerifiedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        conversationId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await checkPermission(
        ctx.session.user.id,
        input.organizationId,
        "ai:manage",
      );
      const repository = ctx.scope.resolve(AIRepositoryToken);
      const conversation = await repository.findConversation(
        input.conversationId,
        input.organizationId,
        ctx.session.user.id,
      );
      if (!conversation) return { deleted: false };
      await repository.deleteConversation(
        input.conversationId,
        input.organizationId,
        ctx.session.user.id,
      );
      return { deleted: true };
    }),
});
