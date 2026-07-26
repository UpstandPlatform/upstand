import { describe, expect, test } from "bun:test";
import { RollbackResourceInputSchema } from "../resource/rollback-resource.usecase";
import { matchesDockerImageWebhook } from "./docker-image-webhook";
import { matchesSafeGlob } from "./safe-glob";

describe("Webhooks, Triggers & Rollback Pipelines", () => {
  describe("Safe Glob Pattern Matching for Watch Paths", () => {
    test("matches exact file paths and wildcards", () => {
      expect(matchesSafeGlob("src/*", "src/index.ts")).toBe(true);
      expect(matchesSafeGlob("*.json", "package.json")).toBe(true);
      expect(matchesSafeGlob("src/*", "docs/readme.md")).toBe(false);
    });
  });

  describe("Docker Image Webhook Pipeline Matching", () => {
    test("matches matching repository and tag filters", () => {
      const result = matchesDockerImageWebhook(
        "myorg/webapp:v1.2.3",
        "myorg/webapp",
        "v1.2.3",
      );
      expect(result).toBe(true);
    });

    test("rejects mismatched image tag references", () => {
      const result = matchesDockerImageWebhook(
        "myorg/webapp:v1.2.3",
        "myorg/webapp",
        "v2.0.0",
      );
      expect(result).toBe(false);
    });
  });

  describe("Rollback Resource Input Validation", () => {
    test("validates RollbackResourceInputSchema with resource ID and optional deployment ID", () => {
      const valid = RollbackResourceInputSchema.parse({
        id: "res-uuid-101",
        deploymentId: "dep-uuid-202",
      });
      expect(valid.id).toBe("res-uuid-101");
      expect(valid.deploymentId).toBe("dep-uuid-202");
    });

    test("rejects missing resource ID", () => {
      expect(() => RollbackResourceInputSchema.parse({ id: "" })).toThrow();
    });
  });
});
