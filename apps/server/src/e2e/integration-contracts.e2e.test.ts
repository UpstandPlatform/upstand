import { describe, expect, test } from "bun:test";
import { e2eContext, fetchWithTimeout, trpc } from "./support/local-e2e-client";

describe("local E2E / HTTP and integration contracts", () => {
  test.skipIf(!e2eContext.serverAvailable)(
    "publishes a valid OpenAPI document",
    async () => {
      const response = await fetchWithTimeout(
        `${e2eContext.baseUrl}/api/openapi.json`,
      );
      expect(response.status).toBe(200);
      const document = (await response.json()) as {
        openapi?: string;
        paths?: Record<string, unknown>;
      };
      expect(document.openapi).toMatch(/^3\./);
      expect(Object.keys(document.paths ?? {})).not.toHaveLength(0);
    },
  );

  test.skipIf(!e2eContext.serverAvailable)(
    "does not expose protected resource data without authentication",
    async () => {
      const result = await trpc("resource.get", {
        id: "resource-does-not-exist",
      });
      expect([401, 403]).toContain(result.response.status);
    },
  );

  test.skipIf(!e2eContext.serverAvailable)(
    "keeps the health response independent from database and Docker state",
    async () => {
      const response = await fetchWithTimeout(
        `${e2eContext.baseUrl}/health/live`,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "alive" });
    },
  );

  test.skipIf(!e2eContext.serverAvailable)(
    "publishes a readiness response with an explicit status",
    async () => {
      const response = await fetchWithTimeout(
        `${e2eContext.baseUrl}/health/ready`,
      );
      expect([200, 503]).toContain(response.status);
      const body = (await response.json()) as { status?: string };
      expect(["ready", "not_ready"]).toContain(body.status ?? "");
    },
  );
});
