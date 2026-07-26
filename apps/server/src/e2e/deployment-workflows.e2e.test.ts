import { describe, expect, test } from "bun:test";
import {
  e2eContext,
  getResource,
  trpc,
  trpcJson,
} from "./support/local-e2e-client";

describe("local E2E / deployment workflows", () => {
  const resourceTest = test.skipIf(!e2eContext.resourceConfigured);

  resourceTest(
    "joins the resource, deployment history, and runtime status contracts",
    async () => {
      const resource = await getResource();
      const historyResult = await trpc("deployment.getByResource", {
        resourceId: resource.id,
      });

      expect(historyResult.response.ok).toBe(true);
      const history = trpcJson(historyResult.body);
      expect(Array.isArray(history)).toBe(true);

      for (const deployment of history as Array<{
        id: string;
        resourceId: string;
        status: string;
      }>) {
        expect(deployment.id).toEqual(expect.any(String));
        expect(deployment.resourceId).toBe(resource.id);
        expect(["queued", "running", "success", "failed"]).toContain(
          deployment.status,
        );
      }
    },
  );

  resourceTest(
    "returns routing, statistics, and log contracts for a configured resource",
    async () => {
      const resource = await getResource();
      const [routing, stats, logs] = await Promise.all([
        trpc("resource.getRoutingTargets", { id: resource.id }),
        trpc("resource.getStats", { id: resource.id }),
        trpc("resource.getLogs", { id: resource.id, limit: 20 }),
      ]);

      expect(routing.response.ok).toBe(true);
      expect(stats.response.ok).toBe(true);
      expect(logs.response.ok).toBe(true);
      expect(trpcJson(routing.body)).toBeDefined();
      expect(trpcJson(stats.body)).toBeDefined();
      expect(trpcJson(logs.body)).toBeDefined();
    },
  );

  const mutationTest = test.skipIf(
    !e2eContext.resourceConfigured || !e2eContext.mutationsAllowed,
  );

  mutationTest(
    "rejects rollback requests for an unrelated deployment",
    async () => {
      const result = await trpc(
        "resource.rollback",
        {
          id: e2eContext.resourceId,
          deploymentId: "deployment-does-not-exist",
        },
        "POST",
      );
      expect(result.response.status).toBe(400);
    },
  );

  mutationTest(
    "rejects deployment requests for an unknown resource",
    async () => {
      const result = await trpc(
        "resource.deploy",
        { id: "resource-does-not-exist" },
        "POST",
      );
      expect([400, 404]).toContain(result.response.status);
    },
  );
});
