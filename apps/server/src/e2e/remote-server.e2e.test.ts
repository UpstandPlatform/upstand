import { describe, expect, test } from "bun:test";
import { e2eContext, trpc, trpcJson } from "./support/local-e2e-client";

type RemoteServer = {
  id: string;
  status: string;
};

type DockerInfo = {
  name: string;
  serverVersion: string;
  operatingSystem: string;
  architecture: string;
  containers: number;
  images: number;
  memoryBytes: number;
  swarmState: string;
};

type DockerContainer = {
  id: string;
  name: string;
  state: string;
};

type DockerNetwork = {
  id: string;
  name: string;
  driver: string;
  scope: string;
};

type SwarmNode = {
  id: string;
  hostname: string;
  isLeader: boolean;
  status?: string;
};

type MonitoringStatus = {
  serverId: string;
  reachable: boolean;
  status: string;
  lastCollectedAt?: string;
  collectionError?: string;
};

type TopologyGraph = {
  nodes: Array<{ id: string; type: string; serverId?: string }>;
  edges: Array<{ source: string; target: string; type: string }>;
  updatedAt: string;
};

const remoteServerId = e2eContext.remoteServerId ?? "";

function remoteInput(extra: Record<string, unknown> = {}) {
  return {
    organizationId: e2eContext.organizationId,
    serverId: remoteServerId,
    ...extra,
  };
}

async function inventory<T>(kind: string): Promise<T> {
  const result = await trpc("server.inventory", remoteInput({ kind }));
  expect(result.response.ok).toBe(true);
  return trpcJson(result.body) as T;
}

describe("remote server E2E", () => {
  const remoteTest = test.skipIf(!e2eContext.remoteServerConfigured);

  remoteTest(
    "validates the configured host, clock, and monitoring agent",
    async () => {
      const serverResult = await trpc("server.one", {
        organizationId: e2eContext.organizationId,
        id: remoteServerId,
      });
      expect(serverResult.response.ok).toBe(true);
      const server = trpcJson(serverResult.body) as RemoteServer;
      expect(server.id).toBe(remoteServerId);
      expect(server.status).toBe("ready");

      const validationResult = await trpc("server.validate", remoteInput());
      expect(validationResult.response.ok).toBe(true);
      const info = trpcJson(validationResult.body) as DockerInfo;
      expect(info.name).toEqual(expect.any(String));
      expect(info.serverVersion).toEqual(expect.any(String));
      expect(info.operatingSystem).toEqual(expect.any(String));
      expect(info.architecture).toEqual(expect.any(String));
      expect(info.containers).toBeGreaterThanOrEqual(2);
      expect(info.images).toBeGreaterThan(0);
      expect(info.memoryBytes).toBeGreaterThan(0);
      expect(info.swarmState).toBe("active");

      const timeResult = await trpc("server.time", remoteInput());
      expect(timeResult.response.ok).toBe(true);
      const hostTime = trpcJson(timeResult.body) as {
        epochSeconds: number;
        iso: string;
      };
      expect(hostTime.iso).toEqual(expect.any(String));
      expect(Math.abs(Date.now() / 1000 - hostTime.epochSeconds)).toBeLessThan(
        60,
      );

      const monitoringResult = await trpc(
        "server.monitoringStatus",
        remoteInput(),
      );
      expect(monitoringResult.response.ok).toBe(true);
      const monitoring = trpcJson(monitoringResult.body) as MonitoringStatus;
      expect(monitoring).toMatchObject({
        serverId: remoteServerId,
        reachable: true,
        status: "healthy",
      });
      expect(monitoring.lastCollectedAt).toEqual(expect.any(String));
      expect(monitoring.collectionError ?? "").toBe("");
    },
    30_000,
  );

  remoteTest(
    "keeps provisioned containers, network, and swarm inventory queryable",
    async () => {
      const containers = await inventory<DockerContainer[]>("containers");
      const networks = await inventory<DockerNetwork[]>("networks");
      const nodes = await inventory<SwarmNode[]>("swarm_nodes");

      expect(
        containers.some(
          ({ name, state }) => name === "upstand-caddy" && state === "running",
        ),
      ).toBe(true);
      expect(
        containers.some(
          ({ name, state }) =>
            name === "upstand-monitoring-agent" && state === "running",
        ),
      ).toBe(true);
      expect(
        networks.some(
          ({ name, driver, scope }) =>
            name === "upstand-network" &&
            driver === "overlay" &&
            scope === "swarm",
        ),
      ).toBe(true);
      expect(nodes.length).toBeGreaterThan(0);
      expect(nodes.some(({ isLeader }) => isLeader)).toBe(true);
    },
    30_000,
  );

  remoteTest(
    "keeps the filtered remote topology unique and referentially valid",
    async () => {
      const result = await trpc("topology.getGraph", remoteInput());
      expect(result.response.ok).toBe(true);
      const graph = trpcJson(result.body) as TopologyGraph;

      expect(graph.updatedAt).toEqual(expect.any(String));
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);
      expect(
        graph.nodes.every(({ serverId }) => serverId === remoteServerId),
      ).toBe(true);

      const nodeIds = new Set(graph.nodes.map(({ id }) => id));
      expect(nodeIds.size).toBe(graph.nodes.length);
      expect(graph.nodes.some(({ id }) => id.includes(remoteServerId))).toBe(
        true,
      );

      for (const edge of graph.edges) {
        expect(nodeIds.has(edge.source)).toBe(true);
        expect(nodeIds.has(edge.target)).toBe(true);
      }
    },
    30_000,
  );
});
