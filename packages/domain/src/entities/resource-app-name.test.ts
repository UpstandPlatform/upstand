import { describe, expect, test } from "bun:test";
import { ResourceAppNameSchema } from "./resource";

describe("resource app names", () => {
  test("normalizes safe Docker DNS labels", () => {
    expect(ResourceAppNameSchema.parse("  Checkout_API-1 ")).toBe(
      "checkout_api-1",
    );
  });

  test("rejects host delimiters and oversized names", () => {
    for (const value of [
      "127.0.0.1:2375",
      "http://internal.example",
      "user:password@host",
      "localhost",
      "a".repeat(64),
    ]) {
      expect(ResourceAppNameSchema.safeParse(value).success).toBe(false);
    }
  });
});
