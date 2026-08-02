import { describe, expect, test } from "bun:test";
import { assertApiKeyInOrganization } from "./api-key-scope";

describe("API key organization scope", () => {
  test("accepts a key belonging to the selected organization", () => {
    expect(() =>
      assertApiKeyInOrganization(
        { configId: "upstand", referenceId: "org-a" },
        "org-a",
      ),
    ).not.toThrow();
  });

  test("rejects a key from another organization", () => {
    expect(() =>
      assertApiKeyInOrganization(
        { configId: "upstand", referenceId: "org-b" },
        "org-a",
      ),
    ).toThrow(
      expect.objectContaining({
        code: "FORBIDDEN",
        message: "The API key is not part of this organization.",
      }),
    );
  });

  test("rejects a missing key instead of delegating an unscoped id", () => {
    expect(() => assertApiKeyInOrganization(undefined, "org-a")).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });
});
