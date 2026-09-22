import { describe, expect, test } from "bun:test";
import { getResourcePreflightErrors } from "./resource-preflight";

describe("getResourcePreflightErrors", () => {
  test("guides legacy hosted sources to a local folder on desktop", () => {
    const errors = getResourcePreflightErrors(
      { type: "application", provider: "github", serverId: "server-1" },
      { credentials: JSON.stringify({}) },
      [],
      [],
      { platformMode: "desktop" },
    );

    expect(errors.map((error) => error.id)).toContain("source-app-local-path");
    expect(errors.map((error) => error.id)).not.toContain(
      "source-app-provider-missing",
    );
  });
});
