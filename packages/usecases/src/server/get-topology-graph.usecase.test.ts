import { describe, expect, test } from "bun:test";
import type { DockerTopologySnapshot } from "../ports/docker";
import type {
  GetDockerInventoryInput,
  GetDockerInventoryUseCase,
  GetDockerTopologySnapshotInput,
} from "./get-docker-inventory.usecase";
import type { GetServersUseCase } from "./get-servers.usecase";
import { GetTopologyGraphUseCase } from "./get-topology-graph.usecase";

function makeUseCase(
  inventory: (
    input: { serverId?: string; kind: string },
    options?: { allowLocalInCloud?: boolean },
  ) => unknown,
) {
  return new GetTopologyGraphUseCase(
    {
      execute: async () => [
        {
          id: "remote-1",
          name: "Production",
          ipAddress: "10.0.0.10",
          status: "ready",
        },
      ],
    } as unknown as GetServersUseCase,
    {
      execute: async (
        input: GetDockerInventoryInput,
        options?: { allowLocalInCloud?: boolean },
      ) => inventory(input, options),
      getTopologySnapshot: async (
        input: GetDockerTopologySnapshotInput,
        options?: { allowLocalInCloud?: boolean },
      ): Promise<DockerTopologySnapshot> => {
        const read = async (kind: GetDockerInventoryInput["kind"]) => {
          try {
            return await inventory(
              {
                serverId: input.serverId,
                kind,
              },
              options,
            );
          } catch {
            return null;
          }
        };
        const [containers, networks, volumes, swarmNodes] = await Promise.all([
          read("containers"),
          read("networks"),
          read("volumes"),
          input.includeSwarmNodes ? read("swarm_nodes") : null,
        ]);
        return {
          containers: containers as DockerTopologySnapshot["containers"],
          networks: networks as DockerTopologySnapshot["networks"],
          volumes: volumes as DockerTopologySnapshot["volumes"],
          swarmNodes: swarmNodes as DockerTopologySnapshot["swarmNodes"],
        };
      },
    } as unknown as GetDockerInventoryUseCase,
  );
}

describe("GetTopologyGraphUseCase", () => {
  test("keeps resources and relationships isolated per server", async () => {
    const useCase = makeUseCase(({ serverId, kind }) => {
      if (kind === "containers") {
        return [
          {
            id: "same-container-id",
            name: "web",
            image: "nginx:latest",
            state: "running",
            status: "Up",
            ports: "0.0.0.0:8080->80/tcp,443->443/tcp,443->443/tcp",
            mounts: ["same-volume:/var/lib/app"],
            networks: ["app-net", "bridge"],
            labels: [
              "com.docker.compose.project=demo",
              "com.upstand.resource-id=resource-1",
            ],
            createdAt: null,
          },
        ];
      }
      if (kind === "networks") {
        return [
          {
            id: "same-network-id",
            name: "app-net",
            driver: "bridge",
            scope: "local",
            internal: false,
            attachable: false,
          },
          {
            id: "bridge-id",
            name: "bridge",
            driver: "bridge",
            scope: "local",
            internal: false,
            attachable: false,
          },
        ];
      }
      if (kind === "volumes") {
        return [{ name: "same-volume", driver: "local", mountpoint: "/data" }];
      }
      if (kind === "swarm_nodes") {
        return [
          {
            id: "same-swarm-id",
            hostname: `${serverId}-manager`,
            ip: "10.0.0.11",
            isLeader: true,
            role: "manager",
            status: "ready",
          },
        ];
      }
      return [];
    });

    const graph = await useCase.execute({ organizationId: "org-1" });
    const ids = graph.nodes.map((node) => node.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("container:local:same-container-id");
    expect(ids).toContain("container:remote-1:same-container-id");
    expect(ids).toContain("network:local:same-network-id");
    expect(ids).toContain("network:remote-1:same-network-id");
    expect(ids).toContain("volume:local:same-volume");
    expect(ids).toContain("volume:remote-1:same-volume");
    expect(
      graph.nodes.find((node) => node.id === "volume:remote-1:same-volume"),
    ).toMatchObject({
      resourceId: "resource-1",
      containerId: "same-container-id",
    });
    expect(
      graph.nodes.find(
        (node) => node.id === "container:local:same-container-id",
      ),
    ).toMatchObject({ resourceId: "resource-1" });
    expect(
      graph.nodes.find(
        (node) => node.id === "container:local:same-container-id",
      )?.ports,
    ).toHaveLength(2);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === "server:remote-1" &&
          edge.target === "container:remote-1:same-container-id",
      ),
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === "volume:remote-1:same-volume" &&
          edge.target === "container:remote-1:same-container-id",
      ),
    ).toBe(true);
  });

  test("reads one topology snapshot per reachable server", async () => {
    const snapshotServers: string[] = [];
    const useCase = new GetTopologyGraphUseCase(
      {
        execute: async () => [
          {
            id: "remote-1",
            name: "Production",
            ipAddress: "10.0.0.10",
            status: "ready",
          },
        ],
      } as unknown as GetServersUseCase,
      {
        getTopologySnapshot: async (input: GetDockerTopologySnapshotInput) => {
          snapshotServers.push(input.serverId ?? "local");
          return {
            containers: [],
            networks: [],
            volumes: [],
            swarmNodes: [],
          };
        },
      } as unknown as GetDockerInventoryUseCase,
    );

    await useCase.execute({ organizationId: "org-1" });

    expect(snapshotServers.sort()).toEqual(["local", "remote-1"]);
  });

  test("keeps a server visible when its Docker endpoint is unavailable", async () => {
    const useCase = makeUseCase(({ serverId, kind }) => {
      if (serverId === "remote-1") throw new Error("SSH unavailable");
      if (kind === "containers") return [];
      if (kind === "networks") return [];
      if (kind === "volumes") return [];
      if (kind === "swarm_nodes") return [];
      return [];
    });

    const graph = await useCase.execute({ organizationId: "org-1" });

    expect(graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["server:local", "server:remote-1"]),
    );
    expect(
      graph.nodes.some(
        (node) => node.serverId === "remote-1" && node.type !== "server",
      ),
    ).toBe(false);
  });

  test("can omit the local control-plane topology", async () => {
    const useCase = makeUseCase(() => []);

    const graph = await useCase.execute(
      { organizationId: "org-1" },
      { includeLocal: false },
    );

    expect(graph.nodes.map((node) => node.id)).toEqual(["server:remote-1"]);
  });

  test("passes the explicit cloud-owner local inspection allowance", async () => {
    const allowances: boolean[] = [];
    const useCase = makeUseCase((_input, options) => {
      allowances.push(options?.allowLocalInCloud === true);
      return [];
    });

    await useCase.execute(
      { organizationId: "org-1" },
      { allowLocalInCloud: true },
    );

    expect(allowances.length).toBeGreaterThan(0);
    expect(allowances.every(Boolean)).toBe(true);
  });

  test("does not probe Docker on a server that has not completed setup", async () => {
    const probed: string[] = [];
    const useCase = new GetTopologyGraphUseCase(
      {
        execute: async () => [
          {
            id: "pending-1",
            name: "Awaiting setup",
            ipAddress: "10.0.0.11",
            status: "pending",
          },
        ],
      } as unknown as GetServersUseCase,
      {
        getTopologySnapshot: async (input: GetDockerTopologySnapshotInput) => {
          probed.push(input.serverId ?? "local");
          return {
            containers: [],
            networks: [],
            volumes: [],
            swarmNodes: [],
          };
        },
      } as unknown as GetDockerInventoryUseCase,
    );

    const graph = await useCase.execute(
      { organizationId: "org-1" },
      { includeLocal: false },
    );

    expect(probed).toEqual([]);
    expect(graph.nodes).toEqual([
      expect.objectContaining({
        id: "server:pending-1",
        type: "server",
        status: "pending",
      }),
    ]);
  });
});
