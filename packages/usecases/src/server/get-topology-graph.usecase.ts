import type { Server } from "@upstand/domain";
import { z } from "zod";
import type {
  DockerContainer,
  DockerNetwork,
  DockerVolume,
} from "../ports/docker";
import type { GetDockerInventoryUseCase } from "./get-docker-inventory.usecase";
import type { GetServersUseCase } from "./get-servers.usecase";

export const GetTopologyGraphInputSchema = z.object({
  organizationId: z.string().min(1),
  serverId: z.string().min(1).optional(),
});

export type GetTopologyGraphInput = z.infer<typeof GetTopologyGraphInputSchema>;

export type TopologyNodeScope = "managed" | "platform" | "external";

export interface TopologyNode {
  id: string;
  type: "container" | "network" | "volume" | "server" | "swarm_node";
  name: string;
  image?: string;
  status?: string;
  ports?: Array<{ host: number; container: number; protocol?: string }>;
  labels?: Record<string, string>;
  networkId?: string;
  driver?: string;
  subnet?: string;
  gateway?: string;
  source?: string;
  createdAt?: string;
  serverId?: string;
  serverName?: string;
  resourceId?: string;
  containerId?: string;
  mountPath?: string;
  ipAddress?: string;
  role?: string;
  scope?: TopologyNodeScope;
}

export interface TopologyEdge {
  id: string;
  type: "volume_mount" | "depends_on" | "secondary_network" | "server_host";
  source: string;
  target: string;
  mountPath?: string;
}

export interface TopologyGraphResponse {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  updatedAt: string;
}

type TopologyServer = Pick<Server, "id" | "name" | "ipAddress" | "status">;

const BUILTIN_NETWORKS = new Set(["bridge", "host", "none"]);
const ANONYMOUS_VOLUME = /^[a-f0-9]{64}$/i;

function parsePorts(value: string): Array<{
  host: number;
  container: number;
  protocol?: string;
}> {
  const parsed = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const mapped = part.match(/(\d+)->(\d+)(?:\/(tcp|udp|sctp))?/i);
      if (mapped) {
        return [
          {
            host: Number(mapped[1]),
            container: Number(mapped[2]),
            protocol: mapped[3]?.toLowerCase() ?? "tcp",
          },
        ];
      }

      const exposed = part.match(/(\d+)(?:\/(tcp|udp|sctp))?$/i);
      if (!exposed) return [];
      return [
        {
          host: Number(exposed[1]),
          container: Number(exposed[1]),
          protocol: exposed[2]?.toLowerCase() ?? "tcp",
        },
      ];
    });

  const seen = new Set<string>();
  return parsed.filter((port) => {
    const key = `${port.host}:${port.container}/${port.protocol ?? "tcp"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseLabels(labels: string[] | undefined): Record<string, string> {
  return (labels ?? []).reduce<Record<string, string>>((result, label) => {
    const separator = label.indexOf("=");
    if (separator === -1) result[label] = "true";
    else result[label.slice(0, separator)] = label.slice(separator + 1);
    return result;
  }, {});
}

function isPlatformContainer(
  labels: Record<string, string>,
  name: string,
): boolean {
  return (
    labels["com.upstand.platform"] === "true" ||
    Boolean(labels["com.upstand.component"]) ||
    /^(?:upstand-caddy|upstand-monitoring-agent)(?:[-_]|$)/i.test(name)
  );
}

function isPlatformDockerName(name: string): boolean {
  return /^(?:upstand-network|upstand-caddy|upstand-monitoring|upstand-postgres|upstand-redis|upstand-web|upstand-fumadocs)(?:[-_]|$)/i.test(
    name,
  );
}

function cleanContainerName(container: DockerContainer): string {
  return (container.name || container.id).replace(/^\//, "");
}

function mountParts(mount: string): { name: string; path: string } {
  const separator = mount.indexOf(":");
  if (separator === -1) return { name: mount, path: mount };
  return {
    name: mount.slice(0, separator),
    path: mount.slice(separator + 1) || mount.slice(0, separator),
  };
}

function classifyNetworks(
  names: string[],
  project?: string,
  networkProjects?: Map<string, string>,
): { primary?: string; secondary: string[] } {
  const sorted = [...new Set(names.filter(Boolean))].sort();
  const primary =
    sorted.find((name) => project && networkProjects?.get(name) === project) ??
    sorted.find((name) => !BUILTIN_NETWORKS.has(name)) ??
    sorted[0];
  return { primary, secondary: sorted.filter((name) => name !== primary) };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

export class GetTopologyGraphUseCase {
  constructor(
    private readonly getServers: GetServersUseCase,
    private readonly getDockerInventory: GetDockerInventoryUseCase,
  ) {}

  async execute(input: GetTopologyGraphInput): Promise<TopologyGraphResponse> {
    const configuredServers = await this.getServers.execute({
      organizationId: input.organizationId,
    });
    const allServers: TopologyServer[] = [
      {
        id: "local",
        name: "Local Server",
        ipAddress: "127.0.0.1",
        status: "ready",
      },
      ...configuredServers,
    ];
    const selectedServers =
      input.serverId && input.serverId !== "all"
        ? allServers.filter((server) => server.id === input.serverId)
        : allServers;
    const nodes: TopologyNode[] = selectedServers.map((server) => ({
      id: `server:${server.id}`,
      type: "server" as const,
      name: server.name,
      status: server.id === "local" ? "healthy" : server.status,
      ipAddress: server.ipAddress,
      serverId: server.id,
      scope: "platform",
    }));
    const edges: TopologyEdge[] = [];
    const nodeIds = new Set(nodes.map((node) => node.id));

    for (const server of selectedServers) {
      const serverNodeId = `server:${server.id}`;
      const [containersResult, networksResult, volumesResult, swarmResult] =
        await Promise.allSettled([
          this.getDockerInventory.execute({
            organizationId: input.organizationId,
            serverId: server.id,
            kind: "containers",
            tail: 1000,
          }),
          this.getDockerInventory.execute({
            organizationId: input.organizationId,
            serverId: server.id,
            kind: "networks",
            tail: 1000,
          }),
          this.getDockerInventory.execute({
            organizationId: input.organizationId,
            serverId: server.id,
            kind: "volumes",
            tail: 1000,
          }),
          this.getDockerInventory.execute({
            organizationId: input.organizationId,
            serverId: server.id,
            kind: "swarm_nodes",
            tail: 1000,
          }),
        ]);

      const containers =
        containersResult.status === "fulfilled"
          ? asArray<DockerContainer>(containersResult.value)
          : [];
      const networks =
        networksResult.status === "fulfilled"
          ? asArray<DockerNetwork>(networksResult.value)
          : [];
      const volumes =
        volumesResult.status === "fulfilled"
          ? asArray<DockerVolume>(volumesResult.value)
          : [];

      const networkIdByName = new Map<string, string>();
      const networkProjectByName = new Map<string, string>();
      for (const network of networks) {
        const networkId = `network:${server.id}:${network.id || network.name}`;
        networkIdByName.set(network.name, networkId);
        if (!nodeIds.has(networkId)) {
          nodeIds.add(networkId);
          nodes.push({
            id: networkId,
            type: "network",
            name: network.name,
            driver: network.driver,
            serverId: server.id,
            scope: isPlatformDockerName(network.name) ? "platform" : "external",
          });
        }
      }

      const mountedVolumeNames = new Set<string>();
      const volumeResourceIdByName = new Map<string, string>();
      const volumeContainerIdByName = new Map<string, string>();
      const volumeMountPathByName = new Map<string, string>();
      for (const container of containers) {
        const labels = parseLabels(container.labels);
        const resourceId =
          labels["upstand.resource.id"] ?? labels["com.upstand.resource-id"];
        for (const mount of container.mounts ?? []) {
          const { name, path } = mountParts(mount);
          if (!name) continue;
          mountedVolumeNames.add(name);
          if (resourceId && !volumeResourceIdByName.has(name)) {
            volumeResourceIdByName.set(name, resourceId);
            volumeContainerIdByName.set(name, container.id);
            volumeMountPathByName.set(name, path);
          }
        }
      }
      const volumeIdByName = new Map<string, string>();
      for (const volume of volumes) {
        if (
          ANONYMOUS_VOLUME.test(volume.name) &&
          !mountedVolumeNames.has(volume.name)
        ) {
          continue;
        }
        const volumeId = `volume:${server.id}:${volume.name}`;
        volumeIdByName.set(volume.name, volumeId);
        if (!nodeIds.has(volumeId)) {
          nodeIds.add(volumeId);
          nodes.push({
            id: volumeId,
            type: "volume",
            name: volume.name,
            driver: volume.driver,
            serverId: server.id,
            resourceId: volumeResourceIdByName.get(volume.name),
            containerId: volumeContainerIdByName.get(volume.name),
            mountPath: volumeMountPathByName.get(volume.name),
            scope: volumeResourceIdByName.has(volume.name)
              ? "managed"
              : isPlatformDockerName(volume.name)
                ? "platform"
                : "external",
          });
        }
      }

      const containerIdByName = new Map<string, string>();
      for (const container of containers) {
        containerIdByName.set(
          cleanContainerName(container),
          `container:${server.id}:${container.id}`,
        );
      }
      for (const container of containers) {
        const labels = parseLabels(container.labels);
        const project =
          labels["com.docker.compose.project"] ??
          labels["com.docker.stack.namespace"];
        if (project) {
          for (const networkName of container.networks ?? []) {
            networkProjectByName.set(networkName, project);
          }
        }
      }

      for (const container of containers) {
        const containerId = `container:${server.id}:${container.id}`;
        const name = cleanContainerName(container);
        const labels = parseLabels(container.labels);
        const resourceId =
          labels["upstand.resource.id"] ?? labels["com.upstand.resource-id"];
        const project =
          labels["com.docker.compose.project"] ??
          labels["com.docker.stack.namespace"];
        const { primary, secondary } = classifyNetworks(
          container.networks ?? [],
          project,
          networkProjectByName,
        );
        const primaryNetworkId = primary
          ? networkIdByName.get(primary)
          : undefined;

        if (nodeIds.has(containerId)) continue;
        nodeIds.add(containerId);
        nodes.push({
          id: containerId,
          type: "container",
          name,
          image: container.image,
          status: container.state || container.status,
          ports: parsePorts(container.ports ?? ""),
          labels,
          networkId: primaryNetworkId,
          source: project,
          createdAt: container.createdAt ?? undefined,
          serverId: server.id,
          serverName: server.name,
          resourceId,
          scope: resourceId
            ? "managed"
            : isPlatformContainer(labels, name)
              ? "platform"
              : "external",
        });
        edges.push({
          id: `edge:server:${server.id}:${container.id}`,
          type: "server_host",
          source: serverNodeId,
          target: containerId,
        });

        for (const networkName of secondary) {
          const networkId = networkIdByName.get(networkName);
          if (networkId) {
            edges.push({
              id: `edge:network:${server.id}:${container.id}:${networkName}`,
              type: "secondary_network",
              source: containerId,
              target: networkId,
            });
          }
        }
        for (const mount of container.mounts ?? []) {
          const { name: volumeName, path } = mountParts(mount);
          const volumeId = volumeIdByName.get(volumeName);
          if (volumeId) {
            edges.push({
              id: `edge:volume:${server.id}:${volumeName}:${container.id}`,
              type: "volume_mount",
              source: volumeId,
              target: containerId,
              mountPath: path,
            });
          }
        }
        for (const dependency of (
          labels["com.docker.compose.depends_on"] ?? ""
        ).split(",")) {
          const dependencyName = dependency.split(":")[0]?.trim();
          const dependencyId = dependencyName
            ? containerIdByName.get(dependencyName)
            : undefined;
          if (dependencyId && dependencyId !== containerId) {
            edges.push({
              id: `edge:dependency:${server.id}:${container.id}:${dependencyName}`,
              type: "depends_on",
              source: containerId,
              target: dependencyId,
            });
          }
        }
      }

      if (swarmResult.status === "fulfilled") {
        for (const swarmNode of asArray<{
          id: string;
          hostname: string;
          ip: string;
          isLeader: boolean;
          role?: string;
          status?: string;
        }>(swarmResult.value)) {
          const swarmNodeId = `swarm:${server.id}:${swarmNode.id}`;
          if (nodeIds.has(swarmNodeId)) continue;
          nodeIds.add(swarmNodeId);
          nodes.push({
            id: swarmNodeId,
            type: "swarm_node",
            name: swarmNode.hostname || swarmNode.id,
            role: swarmNode.isLeader ? "leader" : swarmNode.role,
            status: swarmNode.status,
            ipAddress: swarmNode.ip,
            serverId: server.id,
            serverName: server.name,
            scope: "platform",
          });
          edges.push({
            id: `edge:swarm:${server.id}:${swarmNode.id}`,
            type: "server_host",
            source: serverNodeId,
            target: swarmNodeId,
          });
        }
      }
    }

    return { nodes, edges, updatedAt: new Date().toISOString() };
  }
}
