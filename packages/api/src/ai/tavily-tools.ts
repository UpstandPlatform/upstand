import {
  tavilyCrawl,
  tavilyExtract,
  tavilyMap,
  tavilySearch,
} from "@tavily/ai-sdk";
import type { AITavilySettingsRecord, IAIRepository } from "@upstand/domain";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";
import { tool } from "ai";
import { z } from "zod";
import {
  externalUntrustedOutputSchema,
  wrapExternalUntrustedOutput,
} from "./untrusted-content";

export type TavilyToolsResult = {
  enabled: boolean;
  settings: AITavilySettingsRecord | null;
  tools: Record<string, unknown>;
};

const boundedSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(2_000),
  searchDepth: z.enum(["basic", "advanced", "fast", "ultra-fast"]).optional(),
  timeRange: z
    .enum(["year", "month", "week", "day", "y", "m", "w", "d"])
    .optional(),
  exactMatch: z.boolean().optional(),
});
const boundedExtractInputSchema = z.object({
  urls: z.array(z.url()).min(1).max(5),
  extractDepth: z.enum(["basic", "advanced"]).optional(),
  query: z.string().trim().max(500).optional(),
});
const boundedCrawlInputSchema = z.object({
  url: z.url(),
  maxDepth: z.number().int().min(1).max(2).optional(),
  extractDepth: z.enum(["basic", "advanced"]).optional(),
  instructions: z.string().trim().max(500).optional(),
  allowExternal: z.literal(false).optional(),
});
const boundedMapInputSchema = z.object({
  url: z.url(),
  maxDepth: z.number().int().min(1).max(2).optional(),
  instructions: z.string().trim().max(500).optional(),
  allowExternal: z.literal(false).optional(),
});

type ExecutableTavilyTool = {
  description?: string;
  execute(input: unknown): Promise<unknown>;
};

function isExecutableTavilyTool(value: unknown): value is ExecutableTavilyTool {
  return (
    typeof value === "object" &&
    value !== null &&
    "execute" in value &&
    typeof value.execute === "function"
  );
}

function createBoundedTavilyTool<TInput>(
  raw: unknown,
  source: string,
  description: string,
  inputSchema: z.ZodType<TInput>,
): unknown {
  if (!isExecutableTavilyTool(raw)) return undefined;
  return tool({
    description,
    inputSchema,
    outputSchema: externalUntrustedOutputSchema,
    execute: async (input) =>
      wrapExternalUntrustedOutput(source, await raw.execute(input as unknown)),
  });
}

export async function createTavilyToolsForOrg(
  organizationId: string,
  aiRepo: IAIRepository,
): Promise<TavilyToolsResult> {
  const settings = await aiRepo.getTavilySettings(organizationId);
  if (!settings?.enabled) {
    return { enabled: false, settings: null, tools: {} };
  }

  if (
    !settings.apiKeyCiphertext ||
    !settings.apiKeyIv ||
    !settings.apiKeyAuthTag
  ) {
    return { enabled: false, settings, tools: {} };
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret({
      ciphertext: settings.apiKeyCiphertext,
      iv: settings.apiKeyIv,
      authTag: settings.apiKeyAuthTag,
      keyVersion: settings.apiKeyVersion ?? 1,
    });
  } catch {
    return { enabled: false, settings, tools: {} };
  }

  if (!apiKey.trim()) {
    return { enabled: false, settings, tools: {} };
  }

  const tools: Record<string, unknown> = {};

  if (settings.enableSearch) {
    const search = tavilySearch({
      apiKey,
      searchDepth: settings.searchDepth,
      includeAnswer: settings.includeAnswer,
      maxResults: settings.maxResults,
    });
    const boundedSearch = createBoundedTavilyTool(
      search,
      "tavily-search",
      "Search the public web using Tavily with bounded query and result data.",
      boundedSearchInputSchema,
    );
    if (boundedSearch) tools.tavilySearch = boundedSearch;
  }

  if (settings.enableExtract) {
    const extract = tavilyExtract({
      apiKey,
    });
    const boundedExtract = createBoundedTavilyTool(
      extract,
      "tavily-extract",
      "Extract bounded content from up to five public web URLs using Tavily.",
      boundedExtractInputSchema,
    );
    if (boundedExtract) tools.tavilyExtract = boundedExtract;
  }

  if (settings.enableCrawl) {
    const crawl = tavilyCrawl({
      apiKey,
    });
    const boundedCrawl = createBoundedTavilyTool(
      crawl,
      "tavily-crawl",
      "Crawl one public website with depth and output bounds; external domains are disabled.",
      boundedCrawlInputSchema,
    );
    if (boundedCrawl) tools.tavilyCrawl = boundedCrawl;
  }

  if (settings.enableMap) {
    const map = tavilyMap({
      apiKey,
    });
    const boundedMap = createBoundedTavilyTool(
      map,
      "tavily-map",
      "Map one public website with bounded depth and output; external domains are disabled.",
      boundedMapInputSchema,
    );
    if (boundedMap) tools.tavilyMap = boundedMap;
  }

  return { enabled: true, settings, tools };
}
