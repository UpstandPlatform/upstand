import { describe, expect, test } from "bun:test";
import { buildRegistryImageTag } from "./build-registry";

describe("build registry image references", () => {
  test("uses the registry host, image prefix, and normalized service name", () => {
    expect(
      buildRegistryImageTag(
        {
          registryUrl: "https://ghcr.io/",
          imagePrefix: "/acme/",
          username: "ignored-login-name",
        },
        "My App",
      ),
    ).toBe("ghcr.io/acme/my-app:latest");
  });

  test("keeps legacy username fallback when no image prefix is configured", () => {
    expect(
      buildRegistryImageTag(
        { registryUrl: "registry.example.com", username: "team" },
        "web_app",
      ),
    ).toBe("registry.example.com/team/web_app:latest");
  });
});
