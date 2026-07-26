import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway } from "@ai-sdk/gateway";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type {
  AIFeature,
  AIProvider,
  AIProviderConfigRecord,
  IAIRepository,
} from "@upstand/domain";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import type { LanguageModel } from "ai";
import { UpGalError } from "./upgal-errors";

export type UpGalProviderOverrides = {
  /** Look up a specific saved provider config by its ID. */
  providerConfigId?: string;
  /** Override the feature slot used to look up the feature assignment. */
  feature?: AIFeature;
  /** Inline overrides — used when testing before saving. */
  provider?: AIProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
};

export type UpGalResolvedProvider = {
  model: LanguageModel;
  modelId: string;
  temperature: number;
  reasoningEnabled: boolean;
  maxOutputTokens?: number;
};

function decryptProviderApiKey(config: AIProviderConfigRecord | null) {
  if (
    !config?.apiKeyCiphertext ||
    !config.apiKeyIv ||
    !config.apiKeyAuthTag ||
    !config.apiKeyVersion
  ) {
    return undefined;
  }
  return decryptSecret({
    ciphertext: config.apiKeyCiphertext,
    iv: config.apiKeyIv,
    authTag: config.apiKeyAuthTag,
    keyVersion: config.apiKeyVersion,
  });
}

/**
 * Resolve the provider assigned to one UpGal feature, applying test-time
 * overrides only after the organization-scoped stored configuration is read.
 */
export async function getUpGalProvider(
  organizationId: string,
  ai: IAIRepository,
  overrides: UpGalProviderOverrides = {},
): Promise<UpGalResolvedProvider> {
  let stored: AIProviderConfigRecord | null = null;

  if (overrides.providerConfigId) {
    stored = await ai.findProviderConfigById(
      overrides.providerConfigId,
      organizationId,
    );
  } else if (overrides.feature) {
    const assignment = await ai.findFeatureAssignment(
      organizationId,
      overrides.feature,
    );
    if (assignment) {
      stored = await ai.findProviderConfigById(
        assignment.providerConfigId,
        organizationId,
      );
    }
  }

  if (!stored) {
    stored = await ai.findFirstEnabledProviderConfig(organizationId);
  }

  const config = stored
    ? {
        ...stored,
        provider: overrides.provider ?? stored.provider,
        model: overrides.model ?? stored.model,
        baseUrl: overrides.baseUrl || stored.baseUrl,
      }
    : overrides.provider && overrides.model
      ? {
          provider: overrides.provider,
          model: overrides.model,
          baseUrl: overrides.baseUrl || null,
          temperature: null,
          reasoningEnabled: false,
          maxOutputTokens: null,
          enabled: true,
        }
      : null;

  if (!config?.enabled) {
    throw new UpGalError(
      "configuration",
      "Configure an AI provider in Settings → AI before using UpGal.",
    );
  }

  const apiKey = overrides.apiKey?.trim() || decryptProviderApiKey(stored);
  if (!apiKey) {
    throw new UpGalError(
      "authentication",
      "The configured AI provider has no API key.",
    );
  }

  const controls = {
    temperature: config.temperature ?? 0.5,
    reasoningEnabled: config.reasoningEnabled ?? false,
    maxOutputTokens: config.maxOutputTokens ?? undefined,
  };
  const effectiveProvider =
    config.provider === "openai" && apiKey.startsWith("sk-or-v1-")
      ? "openrouter"
      : config.provider;

  if (effectiveProvider === "gateway") {
    const gateway = createGateway({ apiKey });
    const modelId = config.model.includes("/")
      ? config.model
      : `openai/${config.model}`;
    return { model: gateway(modelId), modelId, ...controls };
  }
  if (effectiveProvider === "anthropic") {
    return {
      model: createAnthropic({ apiKey, baseURL: config.baseUrl || undefined })(
        config.model,
      ),
      modelId: config.model,
      ...controls,
    };
  }
  if (effectiveProvider === "google") {
    return {
      model: createGoogleGenerativeAI({
        apiKey,
        baseURL: config.baseUrl || undefined,
      })(config.model),
      modelId: config.model,
      ...controls,
    };
  }
  if (effectiveProvider === "openrouter") {
    return {
      model: createOpenRouter({
        apiKey,
        baseURL: config.baseUrl || undefined,
        headers: {
          "HTTP-Referer": "https://upstand.dev",
          "X-Title": "Upstand",
        },
        appUrl: "https://upstand.dev",
        appName: "Upstand",
      }).chat(config.model),
      modelId: config.model,
      ...controls,
    };
  }

  return {
    model: createOpenAI({
      apiKey,
      baseURL: config.baseUrl || undefined,
    })(config.model),
    modelId: config.model,
    ...controls,
  };
}
