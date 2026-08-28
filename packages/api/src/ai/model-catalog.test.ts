import { describe, expect, test } from "bun:test";
import { getUpGalStaticModelPricing } from "./model-catalog";

describe("UpGal model catalog pricing", () => {
  test("exposes pricing metadata from the checked-in catalog", () => {
    const pricing = getUpGalStaticModelPricing("openai", "gpt-3.5-turbo");

    expect(pricing).toBeDefined();
    expect(pricing?.inputPerMTokensUsd).toBeGreaterThanOrEqual(0);
  });

  test("resolves provider-prefixed IDs without exposing mutable catalog state", () => {
    const pricing = getUpGalStaticModelPricing(
      "openai",
      "openai/gpt-3.5-turbo",
    );
    expect(pricing).toBeDefined();
    expect(pricing?.inputPerMTokensUsd).toBeGreaterThanOrEqual(0);
  });

  test("returns no pricing for unknown models", () => {
    expect(
      getUpGalStaticModelPricing("openai", "definitely-not-a-real-model"),
    ).toBeUndefined();
  });
});
