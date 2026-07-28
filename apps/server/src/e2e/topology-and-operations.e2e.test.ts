import { describe, expect, test } from "bun:test";
import {
  e2eContext,
  getResource,
  trpc,
  trpcJson,
} from "./support/local-e2e-client";

type TopologyGraph = {
  nodes: Array<{ id: string; type: string; serverId?: string }>;
  edges: Array<{ source: string; target: string; type: string }>;
  updatedAt: string;
};

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

describe("local E2E / topology and operations", () => {
  const organizationTest = test.skipIf(!e2eContext.organizationConfigured);
  const resourceTest = test.skipIf(!e2eContext.resourceConfigured);
  const mutationTest = test.skipIf(
    !e2eContext.resourceConfigured || !e2eContext.mutationsAllowed,
  );

  organizationTest(
    "keeps topology nodes unique and edges referentially valid",
    async () => {
      const result = await trpc("topology.getGraph", {
        organizationId: e2eContext.organizationId,
      });

      expect(result.response.ok).toBe(true);
      const graph = trpcJson(result.body) as TopologyGraph;
      expect(Array.isArray(graph.nodes)).toBe(true);
      expect(Array.isArray(graph.edges)).toBe(true);
      expect(graph.updatedAt).toEqual(expect.any(String));

      const nodeIds = new Set(graph.nodes.map((node) => node.id));
      expect(nodeIds.size).toBe(graph.nodes.length);
      expect(nodeIds.has("server:local")).toBe(true);

      for (const edge of graph.edges) {
        expect(nodeIds.has(edge.source)).toBe(true);
        expect(nodeIds.has(edge.target)).toBe(true);
        expect([
          "volume_mount",
          "depends_on",
          "secondary_network",
          "server_host",
        ]).toContain(edge.type);
      }
    },
  );

  organizationTest(
    "keeps topology server filtering and server inventory consistent",
    async () => {
      const [serversResult, countResult, localGraphResult] = await Promise.all([
        trpc("server.list", { organizationId: e2eContext.organizationId }),
        trpc("server.count", { organizationId: e2eContext.organizationId }),
        trpc("topology.getGraph", {
          organizationId: e2eContext.organizationId,
          serverId: "local",
        }),
      ]);

      expect(serversResult.response.ok).toBe(true);
      expect(countResult.response.ok).toBe(true);
      expect(localGraphResult.response.ok).toBe(true);

      const servers = trpcJson(serversResult.body);
      expect(Array.isArray(servers)).toBe(true);
      expect(trpcJson(countResult.body)).toBe((servers as unknown[]).length);

      const localGraph = trpcJson(localGraphResult.body) as TopologyGraph;
      expect(localGraph.nodes.some((node) => node.id === "server:local")).toBe(
        true,
      );
      expect(localGraph.nodes.every((node) => node.serverId === "local")).toBe(
        true,
      );
    },
  );

  resourceTest(
    "keeps configuration, schedules, backups, and deployment history queryable together",
    async () => {
      const resource = await getResource();
      const results = await Promise.all([
        trpc("port.list", { id: resource.id }),
        trpc("mount.list", { id: resource.id }),
        trpc("schedule.list", { resourceId: resource.id }),
        trpc("schedule.listLogs", { resourceId: resource.id, limit: 20 }),
        trpc("backup.listSchedules", { resourceId: resource.id }),
        trpc("backup.listRuns", { resourceId: resource.id, limit: 20 }),
        trpc("backup.listVolumes", { resourceId: resource.id }),
        trpc("backup.listComposeServices", { resourceId: resource.id }),
        trpc("deployment.getByResource", { resourceId: resource.id }),
      ]);

      for (const result of results) expect(result.response.ok).toBe(true);
      expect(Array.isArray(trpcJson(results[0].body))).toBe(true);
      expect(Array.isArray(trpcJson(results[1].body))).toBe(true);
      expect(Array.isArray(trpcJson(results[2].body))).toBe(true);
      expect(Array.isArray(trpcJson(results[3].body))).toBe(true);
      expect(Array.isArray(trpcJson(results[4].body))).toBe(true);
      expect(Array.isArray(trpcJson(results[5].body))).toBe(true);
      expect(Array.isArray(trpcJson(results[6].body))).toBe(true);
      expect(Array.isArray(trpcJson(results[7].body))).toBe(true);
      expect(Array.isArray(trpcJson(results[8].body))).toBe(true);
    },
  );

  resourceTest(
    "rejects missing lifecycle records without creating deployment or schedule state",
    async () => {
      const resource = await getResource();
      const results = await Promise.all([
        trpc(
          "resource.rollback",
          { id: resource.id, deploymentId: "missing-deployment" },
          "POST",
        ),
        trpc(
          "schedule.update",
          { id: "missing-schedule", name: "should-not-exist" },
          "POST",
        ),
        trpc(
          "backup.updateSchedule",
          { id: "missing-backup-schedule", name: "should-not-exist" },
          "POST",
        ),
        trpc(
          "backup.runNow",
          { scheduleId: "missing-backup-schedule" },
          "POST",
        ),
      ]);

      expect(results[0].response.status).toBeGreaterThanOrEqual(400);
      expect(results[1].response.status).toBeGreaterThanOrEqual(400);
      expect(results[2].response.status).toBeGreaterThanOrEqual(400);
      expect(results[3].response.status).toBeGreaterThanOrEqual(400);
    },
  );

  mutationTest(
    "persists and restores resource, port, mount, and cron configuration changes",
    async () => {
      const resource = await getResource();
      const originalDescription = resource.description ?? "";
      let createdPort = false;
      let createdMount = false;
      let scheduleId: string | undefined;

      try {
        const updatedResource = await trpc(
          "resource.update",
          {
            id: resource.id,
            description: `${originalDescription} [e2e]`,
          },
          "POST",
        );
        expect(updatedResource.response.ok).toBe(true);

        const createdPortResult = await trpc(
          "port.create",
          {
            id: resource.id,
            port: { publishedPort: 49123, targetPort: 8080, protocol: "tcp" },
          },
          "POST",
        );
        expect(createdPortResult.response.ok).toBe(true);
        createdPort = true;

        const updatedPortResult = await trpc(
          "port.update",
          {
            id: resource.id,
            index: asArray(trpcJson(createdPortResult.body)).length - 1,
            port: { publishedPort: 49124, targetPort: 8080, protocol: "tcp" },
          },
          "POST",
        );
        expect(updatedPortResult.response.ok).toBe(true);

        const createdMountResult = await trpc(
          "mount.create",
          {
            id: resource.id,
            volume: {
              source: "upstand-e2e-volume",
              target: "/mnt/upstand-e2e",
              readOnly: false,
            },
          },
          "POST",
        );
        expect(createdMountResult.response.ok).toBe(true);
        createdMount = true;

        const createdScheduleResult = await trpc(
          "schedule.create",
          {
            resourceId: resource.id,
            name: "Upstand E2E schedule",
            description: "Disposable schedule for lifecycle validation",
            cronExpression: "*/15 * * * *",
            timezone: "UTC",
            jobType: "command",
            shellType: "bash",
            command: "echo upstand-e2e",
            enabled: false,
          },
          "POST",
        );
        expect(createdScheduleResult.response.ok).toBe(true);
        scheduleId = String(
          (trpcJson(createdScheduleResult.body) as { id: string }).id,
        );

        const updatedScheduleResult = await trpc(
          "schedule.update",
          {
            id: scheduleId,
            name: "Upstand E2E schedule updated",
            cronExpression: "0 */2 * * *",
            enabled: false,
          },
          "POST",
        );
        expect(updatedScheduleResult.response.ok).toBe(true);
      } finally {
        if (scheduleId) {
          await trpc("schedule.delete", { id: scheduleId }, "POST");
        }
        if (createdMount) {
          const mountsResult = await trpc("mount.list", { id: resource.id });
          const mounts = asArray(trpcJson(mountsResult.body)) as Array<{
            target?: string;
          }>;
          const index = mounts.findIndex(
            (mount) => mount.target === "/mnt/upstand-e2e",
          );
          if (index >= 0) {
            await trpc("mount.delete", { id: resource.id, index }, "POST");
          }
        }
        if (createdPort) {
          const portsResult = await trpc("port.list", { id: resource.id });
          const ports = asArray(trpcJson(portsResult.body)) as Array<{
            publishedPort?: number;
          }>;
          const index = ports.findIndex(
            (port) =>
              port.publishedPort === 49123 || port.publishedPort === 49124,
          );
          if (index >= 0) {
            await trpc("port.delete", { id: resource.id, index }, "POST");
          }
        }
        await trpc(
          "resource.update",
          { id: resource.id, description: originalDescription },
          "POST",
        );
      }
    },
  );

  const backupMutationTest = test.skipIf(
    !e2eContext.resourceConfigured ||
      !e2eContext.mutationsAllowed ||
      !e2eContext.backupDestinationId,
  );

  backupMutationTest(
    "creates, updates, lists, and deletes a disposable backup schedule",
    async () => {
      const resource = await getResource();
      const created = await trpc(
        "backup.createSchedule",
        {
          resourceId: resource.id,
          destinationId: e2eContext.backupDestinationId,
          name: "Upstand E2E backup",
          kind: "volume",
          cronExpression: "0 3 * * *",
          timezone: "UTC",
          prefix: "e2e",
          volumeName: "upstand-e2e-volume",
          enabled: false,
        },
        "POST",
      );
      expect(created.response.ok).toBe(true);
      const scheduleId = String((trpcJson(created.body) as { id: string }).id);

      try {
        const updated = await trpc(
          "backup.updateSchedule",
          {
            id: scheduleId,
            name: "Upstand E2E backup updated",
            retentionCount: 3,
          },
          "POST",
        );
        expect(updated.response.ok).toBe(true);

        const listed = await trpc("backup.listSchedules", {
          resourceId: resource.id,
        });
        expect(listed.response.ok).toBe(true);
        expect(
          asArray(trpcJson(listed.body)).some(
            (schedule) =>
              typeof schedule === "object" &&
              schedule !== null &&
              "id" in schedule &&
              (schedule as { id?: string }).id === scheduleId,
          ),
        ).toBe(true);
      } finally {
        await trpc("backup.deleteSchedule", { id: scheduleId }, "POST");
      }
    },
  );
});
