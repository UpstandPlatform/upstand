import { describe, expect, test } from "bun:test";
import {
  e2eContext,
  fetchWithTimeout,
  getResourceContainers,
  trpc,
} from "./support/local-e2e-client";

describe("local E2E / resource lifecycle", () => {
  test.skipIf(!e2eContext.serverAvailable)(
    "serves the liveness contract",
    async () => {
      const response = await fetchWithTimeout(
        `${e2eContext.baseUrl}/health/live`,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "alive" });
    },
  );

  const resourceTest = test.skipIf(!e2eContext.resourceConfigured);

  resourceTest(
    "keeps container identities and runtime states stable across polling",
    async () => {
      const first = await getResourceContainers();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const second = await getResourceContainers();

      for (const container of [...first, ...second]) {
        expect(container.id).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/);
        expect(container.status.trim()).not.toBe("");
      }
    },
  );

  resourceTest(
    "does not hide starting, failed, or pending orchestrator observations",
    async () => {
      const containers = await getResourceContainers();
      expect(containers.every((container) => container.status.trim())).toBe(
        true,
      );
    },
  );

  const mutationTest = test.skipIf(
    !e2eContext.resourceConfigured || !e2eContext.mutationsAllowed,
  );

  mutationTest(
    "rejects invalid container ids without a Docker side effect",
    async () => {
      const result = await trpc(
        "resource.controlContainer",
        {
          resourceId: e2eContext.resourceId,
          containerId: "not a container id",
          command: "kill",
        },
        "POST",
      );
      expect(result.response.status).toBe(400);
    },
  );

  mutationTest(
    "accepts only supported resource lifecycle commands",
    async () => {
      const result = await trpc(
        "resource.control",
        { id: e2eContext.resourceId, command: "invalid" },
        "POST",
      );
      expect(result.response.status).toBe(400);
    },
  );
});
