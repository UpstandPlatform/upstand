import { describe, expect, test } from "bun:test";
import {
  e2eContext,
  getResource,
  trpc,
  trpcJson,
} from "./support/local-e2e-client";

describe("local E2E / resource types and configuration", () => {
  const resourceTest = test.skipIf(!e2eContext.resourceConfigured);

  resourceTest(
    "returns a public resource shape without secret material",
    async () => {
      const result = await trpc("resource.get", {
        id: e2eContext.resourceId,
      });
      expect(result.response.ok).toBe(true);
      const resource = trpcJson(result.body) as Record<string, unknown>;

      expect(resource.id).toBe(e2eContext.resourceId);
      expect(["application", "compose", "database"]).toContain(
        resource.type as string,
      );
      expect(resource).not.toHaveProperty("credentials");
      expect(resource).not.toHaveProperty("buildSecrets");
      expect(resource).not.toHaveProperty("envVars");
    },
  );

  resourceTest(
    "keeps type-specific configuration internally consistent",
    async () => {
      const resource = await getResource();

      if (resource.type === "compose") {
        expect(["compose", "stack", null, undefined]).toContain(
          resource.composeType,
        );
      }

      if (resource.type === "application") {
        const previews = await trpc("resource.getPreviews", {
          id: resource.id,
        });
        expect(previews.response.ok).toBe(true);
        expect(Array.isArray(trpcJson(previews.body))).toBe(true);
      }
    },
  );

  resourceTest(
    "does not return a different resource when queried repeatedly",
    async () => {
      const first = await getResource();
      const second = await getResource();
      expect(second.id).toBe(first.id);
      expect(second.type).toBe(first.type);
    },
  );
});
