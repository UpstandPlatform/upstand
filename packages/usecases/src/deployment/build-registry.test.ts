import { describe, expect, test } from "bun:test";
import {
  buildRegistryImageTag,
  normalizeBuildImageTag,
} from "./build-registry";

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
        "deployment-123",
      ),
    ).toBe("ghcr.io/acme/my-app:deployment-123");
  });

  test("keeps legacy username fallback when no image prefix is configured", () => {
    expect(
      buildRegistryImageTag(
        { registryUrl: "registry.example.com", username: "team" },
        "web_app",
        "deployment-456",
      ),
    ).toBe("registry.example.com/team/web_app:deployment-456");
  });

  test("normalizes deployment identifiers into safe bounded Docker tags", () => {
    expect(normalizeBuildImageTag(" Deployment/ABC 123 ")).toBe(
      "deployment-abc-123",
    );
    expect(normalizeBuildImageTag("...")).toBe("latest");
  });
});
