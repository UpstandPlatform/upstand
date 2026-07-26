import {
  tavilyCrawl,
  tavilyExtract,
  tavilyMap,
  tavilySearch,
} from "@tavily/ai-sdk";
import type { AITavilySettingsRecord, IAIRepository } from "@upstand/domain";
import { decryptSecret } from "@upstand/platform/crypto/secret-box";

export type TavilyToolsResult = {
  enabled: boolean;
  settings: AITavilySettingsRecord | null;
  tools: Record<string, unknown>;
};

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
    tools.tavilySearch = tavilySearch({
      apiKey,
      searchDepth: settings.searchDepth,
      includeAnswer: settings.includeAnswer,
      maxResults: settings.maxResults,
    });
  }

  if (settings.enableExtract) {
    tools.tavilyExtract = tavilyExtract({
      apiKey,
    });
  }

  if (settings.enableCrawl) {
    tools.tavilyCrawl = tavilyCrawl({
      apiKey,
    });
  }

  if (settings.enableMap) {
    tools.tavilyMap = tavilyMap({
      apiKey,
    });
  }

  return { enabled: true, settings, tools };
}
