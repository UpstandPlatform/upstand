import { describe, expect, test } from "bun:test";
import type { AIProviderConfigRecord, IAIRepository } from "@upstand/domain";
import {
  assertAllowedModel,
  assertSafeProviderBaseUrl,
  createSafeProviderFetch,
  getUpGalProviderIdentity,
} from "./provider";

function providerConfig(
  overrides: Partial<AIProviderConfigRecord> = {},
): AIProviderConfigRecord {
  return {
    id: "provider-1",
    organizationId: "org-1",
    name: "Test provider",
    provider: "openai",
    model: "gpt-4.1-mini",
    baseUrl: null,
    temperature: null,
    reasoningEnabled: false,
    maxOutputTokens: null,
    apiKeyCiphertext: null,
    apiKeyIv: null,
    apiKeyAuthTag: null,
    apiKeyVersion: null,
    enabled: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

describe("AI provider endpoint policy", () => {
  test("enforces an operator model allowlist when configured", () => {
    const previous = process.env.UPGAL_ALLOWED_MODELS;
    process.env.UPGAL_ALLOWED_MODELS = "openai/gpt-4.1, claude-sonnet-4";
    try {
      expect(() => assertAllowedModel("gpt-4.1", "openai")).not.toThrow();
      expect(() =>
        assertAllowedModel("claude-sonnet-4", "anthropic"),
      ).not.toThrow();
      expect(() => assertAllowedModel("gpt-5", "openai")).toThrow(
        "operator allowlist",
      );
    } finally {
      if (previous === undefined) delete process.env.UPGAL_ALLOWED_MODELS;
      else process.env.UPGAL_ALLOWED_MODELS = previous;
    }
  });

  test("accepts official HTTPS endpoints", async () => {
    await expect(
      assertSafeProviderBaseUrl("https://api.openai.com/v1", "openai"),
    ).resolves.toBeUndefined();
  });

  test("rejects non-HTTPS endpoints", async () => {
    await expect(
      assertSafeProviderBaseUrl("http://api.openai.com/v1", "openai"),
    ).rejects.toThrow("must use HTTPS");
  });

  test("rejects unapproved custom endpoints by default", async () => {
    await expect(
      assertSafeProviderBaseUrl("https://example.com/v1", "openai"),
    ).rejects.toThrow("Custom AI provider endpoints are disabled");
  });

  test("revalidates custom provider DNS before every SDK request", async () => {
    const previousAllowCustom = process.env.UPGAL_ALLOW_CUSTOM_BASE_URL;
    const previousPlatform = process.env.UPSTAND_PLATFORM;
    const previousCloud = process.env.IS_CLOUD;
    let fetchCalls = 0;
    let fetchInit: RequestInit | undefined;
    process.env.UPGAL_ALLOW_CUSTOM_BASE_URL = "true";
    process.env.UPSTAND_PLATFORM = "self-hosted";
    process.env.IS_CLOUD = "false";
    try {
      const safeFetch = createSafeProviderFetch("openai", {
        configuredBaseUrl: "https://ai.example.test/v1",
        resolveAddresses: async () => [{ address: "8.8.8.8" }],
        baseFetch: async (_input, init) => {
          fetchCalls += 1;
          fetchInit = init;
          return new Response("ok");
        },
      });

      await expect(
        safeFetch("https://ai.example.test/v1/chat/completions"),
      ).resolves.toBeInstanceOf(Response);
      expect(fetchCalls).toBe(1);
      expect(fetchInit?.redirect).toBe("error");
    } finally {
      if (previousAllowCustom === undefined) {
        delete process.env.UPGAL_ALLOW_CUSTOM_BASE_URL;
      } else {
        process.env.UPGAL_ALLOW_CUSTOM_BASE_URL = previousAllowCustom;
      }
      if (previousPlatform === undefined) delete process.env.UPSTAND_PLATFORM;
      else process.env.UPSTAND_PLATFORM = previousPlatform;
      if (previousCloud === undefined) delete process.env.IS_CLOUD;
      else process.env.IS_CLOUD = previousCloud;
    }
  });

  test("blocks a custom provider when DNS changes to a private address", async () => {
    const previousAllowCustom = process.env.UPGAL_ALLOW_CUSTOM_BASE_URL;
    const previousPlatform = process.env.UPSTAND_PLATFORM;
    const previousCloud = process.env.IS_CLOUD;
    let fetchCalls = 0;
    process.env.UPGAL_ALLOW_CUSTOM_BASE_URL = "true";
    process.env.UPSTAND_PLATFORM = "self-hosted";
    process.env.IS_CLOUD = "false";
    try {
      const safeFetch = createSafeProviderFetch("openai", {
        configuredBaseUrl: "https://ai.example.test/v1",
        resolveAddresses: async () => [{ address: "127.0.0.1" }],
        baseFetch: async () => {
          fetchCalls += 1;
          return new Response("should not be called");
        },
      });

      await expect(
        safeFetch("https://ai.example.test/v1/chat/completions"),
      ).rejects.toThrow("cannot resolve to private");
      expect(fetchCalls).toBe(0);
    } finally {
      if (previousAllowCustom === undefined) {
        delete process.env.UPGAL_ALLOW_CUSTOM_BASE_URL;
      } else {
        process.env.UPGAL_ALLOW_CUSTOM_BASE_URL = previousAllowCustom;
      }
      if (previousPlatform === undefined) delete process.env.UPSTAND_PLATFORM;
      else process.env.UPSTAND_PLATFORM = previousPlatform;
      if (previousCloud === undefined) delete process.env.IS_CLOUD;
      else process.env.IS_CLOUD = previousCloud;
    }
  });

  test("keeps requests on the configured provider origin", async () => {
    const safeFetch = createSafeProviderFetch("openai", {
      configuredBaseUrl: "https://ai.example.test/v1",
      baseFetch: async () => new Response("should not be called"),
    });

    await expect(
      safeFetch("https://different.example.test/v1/chat/completions"),
    ).rejects.toThrow("configured provider origin");
  });
});

describe("AI provider identity resolution", () => {
  test("follows the organization feature assignment without reading credentials", async () => {
    let fallbackLookups = 0;
    const assigned = providerConfig({
      id: "assigned",
      provider: "anthropic",
      model: "claude-sonnet-4",
    });
    const repository = {
      findFeatureAssignment: async (
        organizationId: string,
        feature: "chat",
      ) => {
        expect(organizationId).toBe("org-1");
        expect(feature).toBe("chat");
        return {
          id: "assignment-1",
          organizationId,
          feature,
          providerConfigId: assigned.id,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        };
      },
      findProviderConfigById: async (id: string, organizationId: string) => {
        expect(id).toBe(assigned.id);
        expect(organizationId).toBe("org-1");
        return assigned;
      },
      findFirstEnabledProviderConfig: async () => {
        fallbackLookups += 1;
        return null;
      },
    } as Pick<
      IAIRepository,
      | "findFeatureAssignment"
      | "findProviderConfigById"
      | "findFirstEnabledProviderConfig"
    > as IAIRepository;

    await expect(
      getUpGalProviderIdentity("org-1", repository, { feature: "chat" }),
    ).resolves.toEqual({ provider: "anthropic", modelId: "claude-sonnet-4" });
    expect(fallbackLookups).toBe(0);
  });

  test("applies inline model overrides for provider tests", async () => {
    const repository = {
      findFirstEnabledProviderConfig: async () =>
        providerConfig({ model: "gpt-4.1" }),
    } as Pick<IAIRepository, "findFirstEnabledProviderConfig"> as IAIRepository;

    await expect(
      getUpGalProviderIdentity("org-1", repository, {
        provider: "openrouter",
        model: "openai/gpt-4.1-mini",
      }),
    ).resolves.toEqual({
      provider: "openrouter",
      modelId: "openai/gpt-4.1-mini",
    });
  });

  test("returns no identity when no enabled provider is available", async () => {
    const repository = {
      findFirstEnabledProviderConfig: async () => null,
    } as Pick<IAIRepository, "findFirstEnabledProviderConfig"> as IAIRepository;

    await expect(
      getUpGalProviderIdentity("org-1", repository),
    ).resolves.toBeUndefined();
  });
});
