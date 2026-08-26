import { describe, expect, test } from "bun:test";
import { assertAllowedModel, assertSafeProviderBaseUrl } from "./provider";

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
});
