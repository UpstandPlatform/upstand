import { lookup } from "node:dns/promises";
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
import { env } from "@upstand/env/server";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import { isBlockedAddress } from "@upstand/platform/network/outbound";
import { getConfiguredControlPlaneMode } from "@upstand/usecases";
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
  provider: AIProvider;
  modelId: string;
  temperature: number;
  reasoningEnabled: boolean;
  maxOutputTokens?: number;
};

type ResolvedProviderConfig = {
  provider: AIProvider;
  model: string;
  baseUrl: string | null;
  enabled: boolean;
  temperature: number | null;
  reasoningEnabled: boolean;
  maxOutputTokens: number | null;
};

const OFFICIAL_PROVIDER_HOSTS: Record<AIProvider, ReadonlySet<string>> = {
  openai: new Set(["api.openai.com"]),
  anthropic: new Set(["api.anthropic.com"]),
  google: new Set(["generativelanguage.googleapis.com"]),
  openrouter: new Set(["openrouter.ai", "openrouter.ai"]),
  gateway: new Set(["ai-gateway.vercel.sh"]),
};

type ProviderAddressResolver = (
  hostname: string,
) => Promise<ReadonlyArray<{ address: string }>>;

const resolveProviderAddresses: ProviderAddressResolver = (hostname) =>
  lookup(hostname, { all: true });

export async function assertSafeProviderBaseUrl(
  baseUrl: string | null | undefined,
  provider: AIProvider,
  resolveAddresses: ProviderAddressResolver = resolveProviderAddresses,
): Promise<void> {
  if (!baseUrl?.trim()) return;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new UpGalError("validation", "AI provider base URL is invalid.");
  }
  if (parsed.protocol !== "https:") {
    throw new UpGalError("validation", "AI provider base URL must use HTTPS.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const official = OFFICIAL_PROVIDER_HOSTS[provider]?.has(hostname) ?? false;
  if (
    !official &&
    (!env.UPGAL_ALLOW_CUSTOM_BASE_URL ||
      getConfiguredControlPlaneMode() === "cloud")
  ) {
    throw new UpGalError(
      "validation",
      "Custom AI provider endpoints are disabled. Use an official provider endpoint or explicitly enable custom endpoints on a self-hosted instance.",
    );
  }
  if (official) return;

  if (isBlockedAddress(hostname)) {
    throw new UpGalError(
      "validation",
      "AI provider endpoints cannot target private, loopback, or metadata addresses.",
    );
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = [...(await resolveAddresses(hostname))];
  } catch {
    throw new UpGalError(
      "validation",
      "AI provider hostname could not be resolved.",
    );
  }
  if (addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new UpGalError(
      "validation",
      "AI provider endpoints cannot resolve to private, loopback, or metadata addresses.",
    );
  }
}

type SafeProviderFetchOptions = {
  configuredBaseUrl?: string | null;
  resolveAddresses?: ProviderAddressResolver;
  baseFetch?: ProviderFetch;
};

type ProviderFetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

/**
 * Re-check the provider destination for every request. Provider SDKs retain a
 * configured base URL and may send requests much later than configuration
 * validation, so validating only during model resolution is vulnerable to a
 * DNS time-of-check/time-of-use change on self-hosted custom endpoints.
 */
export function createSafeProviderFetch(
  provider: AIProvider,
  options: SafeProviderFetchOptions = {},
): typeof fetch {
  const configuredBaseUrl = options.configuredBaseUrl?.trim() || null;
  const resolveAddresses = options.resolveAddresses ?? resolveProviderAddresses;
  const baseFetch = options.baseFetch ?? globalThis.fetch;
  let configuredOrigin: string | null = null;

  if (configuredBaseUrl) {
    try {
      configuredOrigin = new URL(configuredBaseUrl).origin;
    } catch {
      // Configuration validation reports the actionable error before a model
      // is constructed. Keep this wrapper defensive for direct consumers.
    }
  }

  const safeFetch = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    let requestUrl: URL;
    try {
      requestUrl = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
    } catch {
      throw new UpGalError("validation", "AI provider request URL is invalid.");
    }

    if (requestUrl.protocol !== "https:") {
      throw new UpGalError(
        "validation",
        "AI provider requests must use HTTPS.",
      );
    }

    if (!configuredBaseUrl) {
      const official = OFFICIAL_PROVIDER_HOSTS[provider]?.has(
        requestUrl.hostname.toLowerCase().replace(/^\[|\]$/g, ""),
      );
      if (!official) {
        throw new UpGalError(
          "validation",
          "AI provider requests must target the configured official provider endpoint.",
        );
      }
    } else if (configuredOrigin !== requestUrl.origin) {
      throw new UpGalError(
        "validation",
        "AI provider requests must remain on the configured provider origin.",
      );
    }

    await assertSafeProviderBaseUrl(
      requestUrl.origin,
      provider,
      resolveAddresses,
    );

    return baseFetch(input, { ...init, redirect: "error" });
  };

  return Object.assign(safeFetch, {
    // Bun exposes this fetch companion method in its global type. Preserve it
    // for SDK compatibility while all HTTP requests still pass through the
    // guarded callable above.
    preconnect: globalThis.fetch.preconnect,
  }) as typeof fetch;
}

export function assertAllowedModel(model: string, provider: AIProvider): void {
  const allowedModels = (env.UPGAL_ALLOWED_MODELS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowedModels.length === 0) return;
  if (
    allowedModels.includes(model) ||
    allowedModels.includes(`${provider}/${model}`)
  ) {
    return;
  }
  throw new UpGalError(
    "validation",
    "The selected AI model is not in the operator allowlist.",
  );
}

async function resolveProviderConfig(
  organizationId: string,
  ai: IAIRepository,
  overrides: UpGalProviderOverrides,
): Promise<{
  config: ResolvedProviderConfig | null;
  stored: AIProviderConfigRecord | null;
}> {
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

  return { config, stored };
}

/** Resolve model identity without decrypting credentials or contacting a provider. */
export async function getUpGalProviderIdentity(
  organizationId: string,
  ai: IAIRepository,
  overrides: UpGalProviderOverrides = {},
): Promise<{ provider: AIProvider; modelId: string } | undefined> {
  const { config } = await resolveProviderConfig(organizationId, ai, overrides);
  if (!config?.enabled) return undefined;
  return { provider: config.provider, modelId: config.model };
}

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
  const { config, stored } = await resolveProviderConfig(
    organizationId,
    ai,
    overrides,
  );

  if (!config?.enabled) {
    throw new UpGalError(
      "configuration",
      "Configure an AI provider in Settings → AI before using UpGal.",
    );
  }

  await assertSafeProviderBaseUrl(config.baseUrl, config.provider);
  assertAllowedModel(config.model, config.provider);

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
    maxOutputTokens:
      config.maxOutputTokens == null
        ? undefined
        : Math.min(config.maxOutputTokens, 32_768),
  };
  const effectiveProvider =
    config.provider === "openai" && apiKey.startsWith("sk-or-v1-")
      ? "openrouter"
      : config.provider;
  const safeFetch = createSafeProviderFetch(effectiveProvider, {
    configuredBaseUrl: config.baseUrl,
  });

  if (effectiveProvider === "gateway") {
    const gateway = createGateway({ apiKey, fetch: safeFetch });
    const modelId = config.model.includes("/")
      ? config.model
      : `openai/${config.model}`;
    return {
      model: gateway(modelId),
      provider: effectiveProvider,
      modelId,
      ...controls,
    };
  }
  if (effectiveProvider === "anthropic") {
    return {
      model: createAnthropic({
        apiKey,
        baseURL: config.baseUrl || undefined,
        fetch: safeFetch,
      })(config.model),
      provider: effectiveProvider,
      modelId: config.model,
      ...controls,
    };
  }
  if (effectiveProvider === "google") {
    return {
      model: createGoogleGenerativeAI({
        apiKey,
        baseURL: config.baseUrl || undefined,
        fetch: safeFetch,
      })(config.model),
      provider: effectiveProvider,
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
        fetch: safeFetch,
      }).chat(config.model),
      provider: effectiveProvider,
      modelId: config.model,
      ...controls,
    };
  }

  return {
    model: createOpenAI({
      apiKey,
      baseURL: config.baseUrl || undefined,
      fetch: safeFetch,
    })(config.model),
    provider: effectiveProvider,
    modelId: config.model,
    ...controls,
  };
}
