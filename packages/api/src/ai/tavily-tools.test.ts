import { describe, expect, test } from "bun:test";
import type { AITavilySettingsRecord, IAIRepository } from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import { createTavilyToolsForOrg } from "./tavily-tools";

describe("createTavilyToolsForOrg", () => {
  test("returns enabled: false when no settings exist", async () => {
    const mockRepo: Partial<IAIRepository> = {
      getTavilySettings: async () => null,
    };
    const result = await createTavilyToolsForOrg(
      "org-1",
      mockRepo as IAIRepository,
    );
    expect(result.enabled).toBe(false);
    expect(result.tools).toEqual({});
  });

  test("returns enabled: false when settings are disabled", async () => {
    const mockSettings: AITavilySettingsRecord = {
      organizationId: "org-1",
      enabled: false,
      apiKeyCiphertext: "abc",
      apiKeyIv: "def",
      apiKeyAuthTag: "ghi",
      apiKeyVersion: 1,
      searchDepth: "basic",
      includeAnswer: false,
      maxResults: 5,
      enableSearch: true,
      enableExtract: false,
      enableCrawl: false,
      enableMap: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const mockRepo: Partial<IAIRepository> = {
      getTavilySettings: async () => mockSettings,
    };
    const result = await createTavilyToolsForOrg(
      "org-1",
      mockRepo as IAIRepository,
    );
    expect(result.enabled).toBe(false);
  });

  test("creates enabled Tavily tools when settings are active and API key is provided", async () => {
    const secret = encryptSecret("tvly-test-api-key");
    const mockSettings: AITavilySettingsRecord = {
      organizationId: "org-1",
      enabled: true,
      apiKeyCiphertext: secret.ciphertext,
      apiKeyIv: secret.iv,
      apiKeyAuthTag: secret.authTag,
      apiKeyVersion: secret.keyVersion,
      searchDepth: "advanced",
      includeAnswer: true,
      maxResults: 10,
      enableSearch: true,
      enableExtract: true,
      enableCrawl: false,
      enableMap: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const mockRepo: Partial<IAIRepository> = {
      getTavilySettings: async () => mockSettings,
    };
    const result = await createTavilyToolsForOrg(
      "org-1",
      mockRepo as IAIRepository,
    );
    expect(result.enabled).toBe(true);
    expect(result.tools).toHaveProperty("tavilySearch");
    expect(result.tools).toHaveProperty("tavilyExtract");
    expect(result.tools).not.toHaveProperty("tavilyCrawl");
    expect(result.tools).toHaveProperty("tavilyMap");
  });
});
