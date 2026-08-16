export const AI_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "gateway",
  "openrouter",
] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];

export function isAIProvider(value: string): value is AIProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

export const AI_FEATURES = ["chat", "template"] as const;
export type AIFeature = (typeof AI_FEATURES)[number];

export function isAIFeature(value: string): value is AIFeature {
  return (AI_FEATURES as readonly string[]).includes(value);
}

import type { JsonObject, JsonValue } from "./json";

export type AIProviderConfigRecord = {
  id: string;
  organizationId: string;
  name: string;
  provider: AIProvider;
  model: string;
  baseUrl: string | null;
  temperature: number | null;
  reasoningEnabled: boolean;
  maxOutputTokens: number | null;
  apiKeyCiphertext: string | null;
  apiKeyIv: string | null;
  apiKeyAuthTag: string | null;
  apiKeyVersion: number | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * The "safe" view of a provider config — no secret fields — returned by the
 * API to the client.
 */
export type AIProviderConfigView = {
  id: string;
  name: string;
  provider: AIProvider;
  model: string;
  baseUrl: string | null;
  temperature: number | null;
  reasoningEnabled: boolean;
  maxOutputTokens: number | null;
  enabled: boolean;
  configured: boolean;
};

export type CreateAIProviderConfig = {
  id: string;
  organizationId: string;
  name: string;
  provider: AIProvider;
  model: string;
  baseUrl: string | null;
  temperature: number | null;
  reasoningEnabled: boolean;
  maxOutputTokens: number | null;
  secret: {
    ciphertext: string;
    iv: string;
    authTag: string;
    keyVersion: number;
  } | null;
};

export type UpdateAIProviderConfig = {
  name?: string;
  provider?: AIProvider;
  model?: string;
  baseUrl?: string | null;
  temperature?: number | null;
  reasoningEnabled?: boolean;
  maxOutputTokens?: number | null;
  secret?: {
    ciphertext: string;
    iv: string;
    authTag: string;
    keyVersion: number;
  } | null;
};

export type AIFeatureAssignmentRecord = {
  id: string;
  organizationId: string;
  feature: AIFeature;
  providerConfigId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AIConversationRecord = {
  id: string;
  organizationId: string;
  userId: string;
  title: string;
  context: JsonObject | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AIMessageRecord = {
  id: string;
  conversationId: string;
  role: string;
  parts: JsonValue[];
  createdAt: Date;
};

export type CreateAIConversation = {
  id: string;
  organizationId: string;
  userId: string;
  context: JsonObject;
};

export type CreateAIRun = {
  id: string;
  conversationId: string;
  organizationId: string;
  userId: string;
  model: string;
};

export type AITavilySettingsRecord = {
  organizationId: string;
  enabled: boolean;
  apiKeyCiphertext: string | null;
  apiKeyIv: string | null;
  apiKeyAuthTag: string | null;
  apiKeyVersion: number | null;
  searchDepth: "basic" | "advanced";
  includeAnswer: boolean;
  maxResults: number;
  enableSearch: boolean;
  enableExtract: boolean;
  enableCrawl: boolean;
  enableMap: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type AITavilySettingsView = {
  enabled: boolean;
  configured: boolean;
  searchDepth: "basic" | "advanced";
  includeAnswer: boolean;
  maxResults: number;
  enableSearch: boolean;
  enableExtract: boolean;
  enableCrawl: boolean;
  enableMap: boolean;
};

export type SaveAITavilySettings = {
  enabled: boolean;
  searchDepth: "basic" | "advanced";
  includeAnswer: boolean;
  maxResults: number;
  enableSearch: boolean;
  enableExtract: boolean;
  enableCrawl: boolean;
  enableMap: boolean;
  secret?: {
    ciphertext: string;
    iv: string;
    authTag: string;
    keyVersion: number;
  } | null;
};

export interface IAIRepository {
  // ── Provider configs ──────────────────────────────────────────────────────
  listProviderConfigs(
    organizationId: string,
  ): Promise<AIProviderConfigRecord[]>;
  findProviderConfigById(
    id: string,
    organizationId: string,
  ): Promise<AIProviderConfigRecord | null>;
  findFirstEnabledProviderConfig(
    organizationId: string,
  ): Promise<AIProviderConfigRecord | null>;
  createProviderConfig(
    input: CreateAIProviderConfig,
  ): Promise<AIProviderConfigRecord>;
  updateProviderConfig(
    id: string,
    organizationId: string,
    patch: UpdateAIProviderConfig,
  ): Promise<void>;
  deleteProviderConfig(id: string, organizationId: string): Promise<void>;

  // ── Feature assignments ───────────────────────────────────────────────────
  listFeatureAssignments(
    organizationId: string,
  ): Promise<AIFeatureAssignmentRecord[]>;
  findFeatureAssignment(
    organizationId: string,
    feature: AIFeature,
  ): Promise<AIFeatureAssignmentRecord | null>;
  saveFeatureAssignment(
    organizationId: string,
    feature: AIFeature,
    providerConfigId: string,
  ): Promise<void>;
  removeFeatureAssignment(
    organizationId: string,
    feature: AIFeature,
  ): Promise<void>;

  // ── Tavily Settings ───────────────────────────────────────────────────────
  getTavilySettings(
    organizationId: string,
  ): Promise<AITavilySettingsRecord | null>;
  saveTavilySettings(
    organizationId: string,
    input: SaveAITavilySettings,
  ): Promise<AITavilySettingsRecord>;

  // ── Conversations ─────────────────────────────────────────────────────────
  createConversation(
    input: CreateAIConversation,
  ): Promise<AIConversationRecord>;
  findConversation(
    conversationId: string,
    organizationId: string,
    userId: string,
  ): Promise<AIConversationRecord | null>;
  listConversations(
    organizationId: string,
    userId: string,
  ): Promise<AIConversationRecord[]>;
  updateConversationTitle(
    conversationId: string,
    organizationId: string,
    userId: string,
    title: string,
  ): Promise<void>;
  deleteConversation(
    conversationId: string,
    organizationId: string,
    userId: string,
  ): Promise<void>;

  // ── Messages ──────────────────────────────────────────────────────────────
  listMessages(conversationId: string): Promise<AIMessageRecord[]>;
  saveMessages(
    conversationId: string,
    messages: readonly AIMessageRecord[],
    organizationId?: string,
    userId?: string,
  ): Promise<void>;

  // ── Runs ──────────────────────────────────────────────────────────────────
  createRun(input: CreateAIRun): Promise<void>;
  updateRun(
    runId: string,
    organizationId: string,
    userId: string,
    patch: { stepCount?: number; status?: string; finishedAt?: Date },
  ): Promise<void>;
}
