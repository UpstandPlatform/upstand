import { describe, expect, test } from "bun:test";
import { assertSafeProviderBaseUrl } from "./provider";

describe("AI provider endpoint policy", () => {
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
