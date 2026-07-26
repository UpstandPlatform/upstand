import { describe, expect, test } from "bun:test";
import { EntityIconSchema } from "./icon";

describe("EntityIconSchema & IconDataUriSchema validation", () => {
  test("accepts valid base64 PNG data URI", () => {
    const validPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const res = EntityIconSchema.safeParse(validPng);
    expect(res.success).toBe(true);
  });

  test("accepts valid HTTP/HTTPS URLs", () => {
    expect(
      EntityIconSchema.safeParse("https://example.com/icon.png").success,
    ).toBe(true);
    expect(
      EntityIconSchema.safeParse("http://example.com/icon.svg").success,
    ).toBe(true);
  });

  test("accepts valid preset identifiers", () => {
    expect(EntityIconSchema.safeParse("preset:database").success).toBe(true);
    expect(EntityIconSchema.safeParse("preset:rocket").success).toBe(true);
  });

  test("accepts null or undefined", () => {
    expect(EntityIconSchema.safeParse(null).success).toBe(true);
    expect(EntityIconSchema.safeParse(undefined).success).toBe(true);
  });

  test("rejects invalid MIME types in data URI", () => {
    const invalidFormat = "data:image/exe;base64,123456";
    const res = EntityIconSchema.safeParse(invalidFormat);
    expect(res.success).toBe(false);
  });

  test("rejects invalid string format", () => {
    expect(EntityIconSchema.safeParse("not-a-valid-icon").success).toBe(false);
    expect(
      EntityIconSchema.safeParse("ftp://example.com/icon.png").success,
    ).toBe(false);
  });

  test("rejects oversized data payload exceeding 512KB limit", () => {
    const oversized = `data:image/png;base64,${"A".repeat(800 * 1024)}`;
    const res = EntityIconSchema.safeParse(oversized);
    expect(res.success).toBe(false);
  });
});
