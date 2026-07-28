import { describe, expect, test } from "bun:test";
import type {
  GetDockerInventoryInput,
  GetDockerInventoryUseCase,
} from "./get-docker-inventory.usecase";
import type { GetServersUseCase } from "./get-servers.usecase";
import { GetTopologyGraphUseCase } from "./get-topology-graph.usecase";

function makeUseCase(
  inventory: (input: { serverId?: string; kind: string }) => unknown,
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
      execute: async (input: GetDockerInventoryInput) => inventory(input),
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
              "upstand.resource.id=resource-1",
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
});
