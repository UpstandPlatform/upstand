import type { AIProvider } from "@upstand/domain";
import type { ProviderInfo, ProviderModel } from "tokenlens";
import { fetchModels } from "tokenlens/fetch";
import { providersCatalog } from "tokenlens/models";

export type UpGalModelCatalogItem = {
  id: string;
  name: string;
  provider: AIProvider;
  providerName: string;
  contextLength?: number;
  inputMax?: number;
  outputMax?: number;
  reasoning: boolean;
  temperature: boolean;
  toolCalling: boolean;
  pricing?: UpGalModelPricing;
  source: "remote" | "static";
};

/** Pricing hints in USD per one million tokens from the public model catalog. */
export type UpGalModelPricing = {
  inputPerMTokensUsd?: number;
  outputPerMTokensUsd?: number;
  reasoningPerMTokensUsd?: number;
  cacheReadPerMTokensUsd?: number;
  cacheWritePerMTokensUsd?: number;
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const providerAliases: Record<AIProvider, string[]> = {
  openai: ["openai"],
  anthropic: ["anthropic"],
  google: ["google", "google-vertex"],
  openrouter: ["openrouter"],
  gateway: ["vercel", "gateway"],
};

const staticCatalog = providersCatalog as unknown as Record<
  string,
  ProviderInfo
>;

const cache = new Map<
  AIProvider,
  { expiresAt: number; models: UpGalModelCatalogItem[] }
>();

function normalizeModel(
  provider: AIProvider,
  providerName: string,
  model: ProviderModel,
  source: UpGalModelCatalogItem["source"],
): UpGalModelCatalogItem {
  const pricing = model.cost
    ? Object.fromEntries(
        Object.entries({
          inputPerMTokensUsd: model.cost.input,
          outputPerMTokensUsd: model.cost.output,
          reasoningPerMTokensUsd: model.cost.reasoning,
          cacheReadPerMTokensUsd: model.cost.cache_read,
          cacheWritePerMTokensUsd: model.cost.cache_write,
        }).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === "number" &&
            Number.isFinite(entry[1]) &&
            entry[1] >= 0,
        ),
      )
    : undefined;
  return {
    id: model.id,
    name: model.name || model.id,
    provider,
    providerName,
    contextLength: model.limit?.context,
    inputMax: model.limit?.input,
    outputMax: model.limit?.output,
    reasoning: model.reasoning === true,
    temperature: model.temperature !== false,
    toolCalling: model.tool_call !== false,
    ...(pricing && Object.keys(pricing).length > 0 ? { pricing } : {}),
    source,
  };
}

function staticModels(provider: AIProvider): UpGalModelCatalogItem[] {
  for (const providerId of providerAliases[provider]) {
    const info = staticCatalog[providerId];
    if (!info) continue;
    return (Object.values(info.models) as ProviderModel[]).map((model) =>
      normalizeModel(provider, info.name || providerId, model, "static"),
    );
  }
  return [];
}

/**
 * Return only checked-in pricing for a model. Runtime budget enforcement keeps
 * the operator ceiling as the fallback because a public catalog can be stale
 * or absent; this helper is for conservative estimates and observability.
 */
export function getUpGalStaticModelPricing(
  provider: AIProvider,
  modelId: string,
): UpGalModelPricing | undefined {
  const normalizedModelId = modelId.includes("/")
    ? modelId.slice(modelId.lastIndexOf("/") + 1)
    : modelId;
  return staticModels(provider).find(
    (model) => model.id === modelId || model.id === normalizedModelId,
  )?.pricing;
}

export function getUpGalPricingCeiling(
  pricing: UpGalModelPricing | undefined,
): number | undefined {
  if (!pricing) return undefined;
  const rates = Object.values(pricing).filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
  return rates.length > 0 ? Math.max(...rates) : undefined;
}

async function remoteModels(provider: AIProvider) {
  for (const providerId of providerAliases[provider]) {
    try {
      const info = await fetchModels({ provider: providerId });
      if (!info) continue;
      return (Object.values(info.models) as ProviderModel[]).map((model) =>
        normalizeModel(provider, info.name || providerId, model, "remote"),
      );
    } catch {
      // A public catalog outage should not prevent a provider from being saved.
    }
  }
  return [];
}

export async function listUpGalModelCatalog(input: {
  provider: AIProvider;
  search?: string;
  forceRefresh?: boolean;
}) {
  const cached = cache.get(input.provider);
  let models =
    !input.forceRefresh && cached && cached.expiresAt > Date.now()
      ? cached.models
      : await remoteModels(input.provider);

  if (models.length === 0) models = staticModels(input.provider);
  if (
    models.length > 0 &&
    (!cached || input.forceRefresh || cached.expiresAt <= Date.now())
  ) {
    cache.set(input.provider, { expiresAt: Date.now() + CACHE_TTL_MS, models });
  }

  const search = input.search?.trim().toLowerCase();
  return models
    .filter(
      (model) =>
        !search ||
        model.id.toLowerCase().includes(search) ||
        model.name.toLowerCase().includes(search),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
