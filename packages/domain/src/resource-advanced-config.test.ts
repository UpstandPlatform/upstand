import { describe, expect, test } from "bun:test";
import { ResourceAdvancedConfigSchema } from "./entities/resource";

describe("resource advanced deployment configuration", () => {
  test("provides safe retry defaults", () => {
    const config = ResourceAdvancedConfigSchema.parse({});

    expect(config.deploymentReliability).toEqual({
      maxAttempts: 3,
      retryBaseSeconds: 2,
      retryMaxSeconds: 60,
      staleAfterSeconds: 1800,
    });
  });

  test("rejects a retry cap below the base delay", () => {
    const result = ResourceAdvancedConfigSchema.safeParse({
      deploymentReliability: {
        retryBaseSeconds: 30,
        retryMaxSeconds: 10,
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["deploymentReliability", "retryMaxSeconds"],
        }),
      );
    }
  });

  test("validates Git cache, LFS, and smoke-test controls together", () => {
    const config = ResourceAdvancedConfigSchema.parse({
      source: {
        reuseWorkspace: true,
        gitLfs: true,
        fetchDepth: 0,
        timeoutSeconds: 1800,
      },
      smokeTest: {
        enabled: true,
        type: "http",
        target: "https://app.example.com/health",
        expectedStatus: 204,
        timeoutSeconds: 15,
        retries: 4,
      },
    });

    expect(config.source).toMatchObject({
      reuseWorkspace: true,
      gitLfs: true,
      fetchDepth: 0,
    });
    expect(config.smokeTest?.expectedStatus).toBe(204);
  });

  test("rejects control characters in container commands", () => {
    const result = ResourceAdvancedConfigSchema.safeParse({
      healthcheck: {
        command: ["CMD-SHELL\nrm -rf /"],
      },
    });

    expect(result.success).toBe(false);
  });
});
