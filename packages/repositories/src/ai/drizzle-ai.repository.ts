import { randomUUID } from "node:crypto";
import {
  aiConversation,
  aiFeatureAssignment,
  aiMessage,
  aiProviderConfig,
  aiRun,
  aiTavilySettings,
} from "@upstand/db";
import type {
  AIConversationRecord,
  AIFeature,
  AIFeatureAssignmentRecord,
  AIMessageRecord,
  AIProviderConfigRecord,
  AITavilySettingsRecord,
  CreateAIConversation,
  CreateAIProviderConfig,
  CreateAIRun,
  IAIRepository,
  JsonValue,
  SaveAITavilySettings,
  UpdateAIProviderConfig,
} from "@upstand/domain";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Executor } from "../shared/types";

export class DrizzleAIRepository implements IAIRepository {
  constructor(private readonly executor: Executor) {}

  // ── Provider configs ──────────────────────────────────────────────────────

  async listProviderConfigs(
    organizationId: string,
  ): Promise<AIProviderConfigRecord[]> {
    const rows = await this.executor
      .select()
      .from(aiProviderConfig)
      .where(eq(aiProviderConfig.organizationId, organizationId))
      .orderBy(asc(aiProviderConfig.createdAt));
    return rows.map((r) => ({
      ...r,
      enabled: r.enabled === 1,
      reasoningEnabled: r.reasoningEnabled === 1,
    }));
  }

  async findProviderConfigById(
    id: string,
    organizationId: string,
  ): Promise<AIProviderConfigRecord | null> {
    const row = await this.executor
      .select()
      .from(aiProviderConfig)
      .where(
        and(
          eq(aiProviderConfig.id, id),
          eq(aiProviderConfig.organizationId, organizationId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);
    return row
      ? {
          ...row,
          enabled: row.enabled === 1,
          reasoningEnabled: row.reasoningEnabled === 1,
        }
      : null;
  }

  async findFirstEnabledProviderConfig(
    organizationId: string,
  ): Promise<AIProviderConfigRecord | null> {
    const row = await this.executor
      .select()
      .from(aiProviderConfig)
      .where(
        and(
          eq(aiProviderConfig.organizationId, organizationId),
          eq(aiProviderConfig.enabled, 1),
        ),
      )
      .orderBy(asc(aiProviderConfig.createdAt))
      .limit(1)
      .then((rows) => rows[0]);
    return row
      ? { ...row, enabled: true, reasoningEnabled: row.reasoningEnabled === 1 }
      : null;
  }

  async createProviderConfig(
    input: CreateAIProviderConfig,
  ): Promise<AIProviderConfigRecord> {
    const [row] = await this.executor
      .insert(aiProviderConfig)
      .values({
        id: input.id,
        organizationId: input.organizationId,
        name: input.name,
        provider: input.provider,
        model: input.model,
        baseUrl: input.baseUrl,
        temperature: input.temperature,
        reasoningEnabled: input.reasoningEnabled ? 1 : 0,
        maxOutputTokens: input.maxOutputTokens,
        enabled: 1,
        apiKeyCiphertext: input.secret?.ciphertext ?? null,
        apiKeyIv: input.secret?.iv ?? null,
        apiKeyAuthTag: input.secret?.authTag ?? null,
        apiKeyVersion: input.secret?.keyVersion ?? null,
      })
      .returning();
    if (!row) throw new Error("AI provider config insert returned no row.");
    return {
      ...row,
      enabled: row.enabled === 1,
      reasoningEnabled: row.reasoningEnabled === 1,
    };
  }

  async updateProviderConfig(
    id: string,
    organizationId: string,
    patch: UpdateAIProviderConfig,
  ): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.provider !== undefined) set.provider = patch.provider;
    if (patch.model !== undefined) set.model = patch.model;
    if (patch.baseUrl !== undefined) set.baseUrl = patch.baseUrl;
    if (patch.temperature !== undefined) set.temperature = patch.temperature;
    if (patch.reasoningEnabled !== undefined)
      set.reasoningEnabled = patch.reasoningEnabled ? 1 : 0;
    if (patch.maxOutputTokens !== undefined)
      set.maxOutputTokens = patch.maxOutputTokens;
    if (patch.secret !== undefined && patch.secret !== null) {
      set.apiKeyCiphertext = patch.secret.ciphertext;
      set.apiKeyIv = patch.secret.iv;
      set.apiKeyAuthTag = patch.secret.authTag;
      set.apiKeyVersion = patch.secret.keyVersion;
    }
    await this.executor
      .update(aiProviderConfig)
      .set(set)
      .where(
        and(
          eq(aiProviderConfig.id, id),
          eq(aiProviderConfig.organizationId, organizationId),
        ),
      );
  }

  async deleteProviderConfig(
    id: string,
    organizationId: string,
  ): Promise<void> {
    await this.executor
      .delete(aiProviderConfig)
      .where(
        and(
          eq(aiProviderConfig.id, id),
          eq(aiProviderConfig.organizationId, organizationId),
        ),
      );
  }

  // ── Feature assignments ───────────────────────────────────────────────────

  async listFeatureAssignments(
    organizationId: string,
  ): Promise<AIFeatureAssignmentRecord[]> {
    return this.executor
      .select()
      .from(aiFeatureAssignment)
      .where(eq(aiFeatureAssignment.organizationId, organizationId));
  }

  async findFeatureAssignment(
    organizationId: string,
    feature: AIFeature,
  ): Promise<AIFeatureAssignmentRecord | null> {
    const row = await this.executor
      .select()
      .from(aiFeatureAssignment)
      .where(
        and(
          eq(aiFeatureAssignment.organizationId, organizationId),
          eq(aiFeatureAssignment.feature, feature),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);
    return row ?? null;
  }

  async saveFeatureAssignment(
    organizationId: string,
    feature: AIFeature,
    providerConfigId: string,
  ): Promise<void> {
    await this.executor
      .insert(aiFeatureAssignment)
      .values({
        id: randomUUID(),
        organizationId,
        feature,
        providerConfigId,
      })
      .onConflictDoUpdate({
        target: [
          aiFeatureAssignment.organizationId,
          aiFeatureAssignment.feature,
        ],
        set: { providerConfigId, updatedAt: new Date() },
      });
  }

  async removeFeatureAssignment(
    organizationId: string,
    feature: AIFeature,
  ): Promise<void> {
    await this.executor
      .delete(aiFeatureAssignment)
      .where(
        and(
          eq(aiFeatureAssignment.organizationId, organizationId),
          eq(aiFeatureAssignment.feature, feature),
        ),
      );
  }

  // ── Tavily Settings ───────────────────────────────────────────────────────

  async getTavilySettings(
    organizationId: string,
  ): Promise<AITavilySettingsRecord | null> {
    const row = await this.executor
      .select()
      .from(aiTavilySettings)
      .where(eq(aiTavilySettings.organizationId, organizationId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!row) return null;
    return {
      organizationId: row.organizationId,
      enabled: row.enabled === 1,
      apiKeyCiphertext: row.apiKeyCiphertext,
      apiKeyIv: row.apiKeyIv,
      apiKeyAuthTag: row.apiKeyAuthTag,
      apiKeyVersion: row.apiKeyVersion,
      searchDepth: (row.searchDepth as "basic" | "advanced") || "basic",
      includeAnswer: row.includeAnswer === 1,
      maxResults: row.maxResults ?? 5,
      enableSearch: row.enableSearch === 1,
      enableExtract: row.enableExtract === 1,
      enableCrawl: row.enableCrawl === 1,
      enableMap: row.enableMap === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async saveTavilySettings(
    organizationId: string,
    input: SaveAITavilySettings,
  ): Promise<AITavilySettingsRecord> {
    const setValues: Record<string, unknown> = {
      enabled: input.enabled ? 1 : 0,
      searchDepth: input.searchDepth,
      includeAnswer: input.includeAnswer ? 1 : 0,
      maxResults: input.maxResults,
      enableSearch: input.enableSearch ? 1 : 0,
      enableExtract: input.enableExtract ? 1 : 0,
      enableCrawl: input.enableCrawl ? 1 : 0,
      enableMap: input.enableMap ? 1 : 0,
      updatedAt: new Date(),
    };

    if (input.secret !== undefined) {
      if (input.secret === null) {
        setValues.apiKeyCiphertext = null;
        setValues.apiKeyIv = null;
        setValues.apiKeyAuthTag = null;
        setValues.apiKeyVersion = null;
      } else {
        setValues.apiKeyCiphertext = input.secret.ciphertext;
        setValues.apiKeyIv = input.secret.iv;
        setValues.apiKeyAuthTag = input.secret.authTag;
        setValues.apiKeyVersion = input.secret.keyVersion;
      }
    }

    const [row] = await this.executor
      .insert(aiTavilySettings)
      .values({
        organizationId,
        enabled: input.enabled ? 1 : 0,
        apiKeyCiphertext: input.secret?.ciphertext ?? null,
        apiKeyIv: input.secret?.iv ?? null,
        apiKeyAuthTag: input.secret?.authTag ?? null,
        apiKeyVersion: input.secret?.keyVersion ?? null,
        searchDepth: input.searchDepth,
        includeAnswer: input.includeAnswer ? 1 : 0,
        maxResults: input.maxResults,
        enableSearch: input.enableSearch ? 1 : 0,
        enableExtract: input.enableExtract ? 1 : 0,
        enableCrawl: input.enableCrawl ? 1 : 0,
        enableMap: input.enableMap ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: aiTavilySettings.organizationId,
        set: setValues,
      })
      .returning();

    if (!row) throw new Error("AI Tavily settings save returned no row.");

    return {
      organizationId: row.organizationId,
      enabled: row.enabled === 1,
      apiKeyCiphertext: row.apiKeyCiphertext,
      apiKeyIv: row.apiKeyIv,
      apiKeyAuthTag: row.apiKeyAuthTag,
      apiKeyVersion: row.apiKeyVersion,
      searchDepth: (row.searchDepth as "basic" | "advanced") || "basic",
      includeAnswer: row.includeAnswer === 1,
      maxResults: row.maxResults ?? 5,
      enableSearch: row.enableSearch === 1,
      enableExtract: row.enableExtract === 1,
      enableCrawl: row.enableCrawl === 1,
      enableMap: row.enableMap === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // ── Conversations ─────────────────────────────────────────────────────────

  async createConversation(
    input: CreateAIConversation,
  ): Promise<AIConversationRecord> {
    const [row] = await this.executor
      .insert(aiConversation)
      .values(input)
      .returning();
    if (!row) throw new Error("AI conversation insert returned no row.");
    return row;
  }

  async findConversation(
    conversationId: string,
    organizationId: string,
    userId: string,
  ): Promise<AIConversationRecord | null> {
    const row = await this.executor
      .select()
      .from(aiConversation)
      .where(
        and(
          eq(aiConversation.id, conversationId),
          eq(aiConversation.organizationId, organizationId),
          eq(aiConversation.userId, userId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);
    return row ?? null;
  }

  async listConversations(
    organizationId: string,
    userId: string,
  ): Promise<AIConversationRecord[]> {
    return this.executor
      .select()
      .from(aiConversation)
      .where(
        and(
          eq(aiConversation.organizationId, organizationId),
          eq(aiConversation.userId, userId),
        ),
      )
      .orderBy(desc(aiConversation.updatedAt))
      .limit(50);
  }

  async updateConversationTitle(
    conversationId: string,
    organizationId: string,
    userId: string,
    title: string,
  ): Promise<void> {
    await this.executor
      .update(aiConversation)
      .set({ title: title.slice(0, 120), updatedAt: new Date() })
      .where(
        and(
          eq(aiConversation.id, conversationId),
          eq(aiConversation.organizationId, organizationId),
          eq(aiConversation.userId, userId),
        ),
      );
  }

  async deleteConversation(
    conversationId: string,
    organizationId: string,
    userId: string,
  ): Promise<void> {
    await this.executor
      .delete(aiConversation)
      .where(
        and(
          eq(aiConversation.id, conversationId),
          eq(aiConversation.organizationId, organizationId),
          eq(aiConversation.userId, userId),
        ),
      );
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  async listMessages(conversationId: string): Promise<AIMessageRecord[]> {
    return this.executor
      .select()
      .from(aiMessage)
      .where(eq(aiMessage.conversationId, conversationId))
      .orderBy(aiMessage.createdAt, aiMessage.id);
  }

  async saveMessages(
    conversationId: string,
    messages: readonly AIMessageRecord[],
    organizationId?: string,
    userId?: string,
  ): Promise<void> {
    if (organizationId && userId) {
      const [conversation] = await this.executor
        .select({ id: aiConversation.id })
        .from(aiConversation)
        .where(
          and(
            eq(aiConversation.id, conversationId),
            eq(aiConversation.organizationId, organizationId),
            eq(aiConversation.userId, userId),
          ),
        )
        .limit(1);
      if (!conversation) {
        throw new Error("AI conversation is not owned by this user.");
      }
    }
    if (messages.length > 0) {
      const valuesToInsert = messages.map((message) => ({
        id: message.id,
        conversationId,
        role: message.role,
        parts: message.parts as JsonValue[],
        createdAt: message.createdAt,
      }));
      await this.executor
        .insert(aiMessage)
        .values(valuesToInsert)
        .onConflictDoUpdate({
          target: aiMessage.id,
          set: {
            role: sql`excluded.role`,
            parts: sql`excluded.parts`,
          },
          where: eq(aiMessage.conversationId, conversationId),
        });
    }
    await this.executor
      .update(aiConversation)
      .set({ updatedAt: new Date() })
      .where(
        organizationId && userId
          ? and(
              eq(aiConversation.id, conversationId),
              eq(aiConversation.organizationId, organizationId),
              eq(aiConversation.userId, userId),
            )
          : eq(aiConversation.id, conversationId),
      );
  }

  // ── Runs ──────────────────────────────────────────────────────────────────

  async createRun(input: CreateAIRun): Promise<void> {
    await this.executor.insert(aiRun).values(input);
  }

  async updateRun(
    runId: string,
    organizationId: string,
    userId: string,
    patch: { stepCount?: number; status?: string; finishedAt?: Date },
  ): Promise<void> {
    await this.executor
      .update(aiRun)
      .set(patch)
      .where(
        and(
          eq(aiRun.id, runId),
          eq(aiRun.organizationId, organizationId),
          eq(aiRun.userId, userId),
        ),
      );
  }
}
