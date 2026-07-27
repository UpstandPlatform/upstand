import { describe, expect, test } from "bun:test";
import { ScimProviderIdSchema } from "./scim.schemas";

describe("SCIM provider ID schema", () => {
  test("accepts normal IdP labels and trims surrounding whitespace", () => {
    expect(ScimProviderIdSchema.parse("  identity-provider  ")).toBe(
      "identity-provider",
    );
    expect(ScimProviderIdSchema.parse("entra.idp_v2:prod")).toBe(
      "entra.idp_v2:prod",
    );
  });

  test("rejects unsafe or ambiguous identifiers", () => {
    for (const value of [
      "provider id",
      "provider/production",
      "provider?redirect=https://example.invalid",
      "provider\nlog-injection",
      "-provider",
      "provider-",
    ]) {
      expect(ScimProviderIdSchema.safeParse(value).success).toBe(false);
    }
  });
});
