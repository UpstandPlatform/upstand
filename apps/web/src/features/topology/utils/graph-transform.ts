import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import type { DGEdge, DGNode } from "../types";
import { networkColor, SERVER_COLOR, VOLUME_COLOR } from "./colors";
import { ANIMATION_NODE_LIMIT, DEFAULT_EDGE_STROKE_WIDTH } from "./constants";

const UNMANAGED_GROUP_ID = "group:unmanaged";
const PLATFORM_GROUP_ID = "group:platform";
const RUNNING_STATUSES = new Set(["running", "healthy", "up", "ready"]);

function isEndpointActive(node: DGNode | undefined): boolean {
  if (!node) return false;
  if (node.type !== "container") return true;
  return RUNNING_STATUSES.has((node.status ?? "").toLowerCase());
}

function buildNetworkGroups(
  networks: DGNode[],
  containers: DGNode[],
): RFNode[] {
  const rfNodes: RFNode[] = [];

  for (const net of networks) {
    rfNodes.push({
      id: net.id,
      type: "networkGroup",
      position: { x: 0, y: 0 },
      data: { dgNode: net },
      style: { width: 260, height: 160 },
    });
  }

  const hasPlatform = containers.some(
    (c) => c.scope === "platform" && !c.networkId,
  );
  if (hasPlatform) {
    rfNodes.push({
      id: PLATFORM_GROUP_ID,
      type: "networkGroup",
      position: { x: 0, y: 0 },
      data: {
        dgNode: {
          id: PLATFORM_GROUP_ID,
          type: "network",
          name: "platform services",
          scope: "platform",
        },
      },
      style: { width: 260, height: 160 },
    });
  }

  const hasUnmanaged = containers.some(
    (c) => c.scope !== "platform" && !c.source && !c.networkId,
  );
  if (hasUnmanaged) {
    rfNodes.push({
      id: UNMANAGED_GROUP_ID,
      type: "networkGroup",
      position: { x: 0, y: 0 },
      data: {
        dgNode: {
          id: UNMANAGED_GROUP_ID,
          type: "network",
          name: "external / unmanaged",
          scope: "external",
        },
      },
      style: { width: 260, height: 160 },
    });
  }

  return rfNodes;
}

function buildServerNodes(servers: DGNode[]): RFNode[] {
  return servers.map((s) => ({
    id: s.id,
    type: "serverNode",
    position: { x: 0, y: 0 },
    data: { dgNode: s },
  }));
}

function buildContainerNodes(
  containers: DGNode[],
  groupIds: Set<string>,
): RFNode[] {
  return containers.map((c) => {
    const node: RFNode = {
      id: c.id,
      type: "containerNode",
      position: { x: 0, y: 0 },
      data: { dgNode: c },
    };
    const group =
      c.networkId ??
      (c.scope === "platform"
        ? PLATFORM_GROUP_ID
        : !c.source
          ? UNMANAGED_GROUP_ID
          : undefined);
    if (group && groupIds.has(group)) {
      node.parentId = group;
      node.extent = "parent";
    }
    return node;
  });
}

function buildVolumeNodes(
  volumes: DGNode[],
  containers: DGNode[],
  dgEdges: DGEdge[],
  groupIds: Set<string>,
): RFNode[] {
  const isHex64 = /^[a-f0-9]{64}$/i;
  const mountedVolumeIds = new Set(
    dgEdges.filter((e) => e.type === "volume_mount").map((e) => e.source),
  );

  const visibleVolumes = volumes.filter(
    (v) => !isHex64.test(v.name) || mountedVolumeIds.has(v.id),
  );

  const containerGroup = new Map<string, string>();
  for (const c of containers) {
    if (c.networkId) {
      containerGroup.set(c.id, c.networkId);
    } else if (c.scope === "platform") {
      containerGroup.set(c.id, PLATFORM_GROUP_ID);
    } else if (!c.source) {
      containerGroup.set(c.id, UNMANAGED_GROUP_ID);
    }
  }

  const volumeGroupMap = new Map<string, string>();
  for (const e of dgEdges.filter((e) => e.type === "volume_mount")) {
    const group = containerGroup.get(e.target);
    if (!volumeGroupMap.has(e.source) && group) {
      volumeGroupMap.set(e.source, group);
    }
  }

  return visibleVolumes.map((v) => {
    const group = volumeGroupMap.get(v.id);
    const node: RFNode = {
      id: v.id,
      type: "volumeNode",
      position: { x: 0, y: 0 },
      data: { dgNode: v },
    };
    if (group && groupIds.has(group)) {
      node.parentId = group;
      node.extent = "parent";
    }
    return node;
  });
}

export function toReactFlowNodes(
  dgNodes: DGNode[],
  dgEdges: DGEdge[],
): RFNode[] {
  const servers = dgNodes.filter(
    (n) => n.type === "server" || n.type === "swarm_node",
  );
  const containers = dgNodes.filter((n) => n.type === "container");
  const networks = dgNodes.filter((n) => n.type === "network");
  const volumes = dgNodes.filter((n) => n.type === "volume");

  const serverNodes = buildServerNodes(servers);
  const groups = buildNetworkGroups(networks, containers);
  const groupIds = new Set(groups.map((n) => n.id));
  const containerNodes = buildContainerNodes(containers, groupIds);
  const volumeNodes = buildVolumeNodes(volumes, containers, dgEdges, groupIds);

  return [...serverNodes, ...groups, ...containerNodes, ...volumeNodes];
}

export function toReactFlowEdges(
  dgEdges: DGEdge[],
  dgNodes: DGNode[],
  defaultStroke: string,
  accentStroke: string = defaultStroke,
): RFEdge[] {
  const nodeMap = new Map(dgNodes.map((n) => [n.id, n]));

  return dgEdges
    .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
    .map((e) => {
      const isVolume = e.type === "volume_mount";
      const isSecondary = e.type === "secondary_network";
      const isServerHost = e.type === "server_host";

      let stroke = e.type === "depends_on" ? accentStroke : defaultStroke;
      if (isVolume) stroke = VOLUME_COLOR;
      if (isServerHost) stroke = SERVER_COLOR;
      if (isSecondary) {
        const targetNet = nodeMap.get(e.target);
        stroke = targetNet ? networkColor(targetNet.name) : defaultStroke;
      }

      const sourceNode = nodeMap.get(e.source);
      const targetNode = nodeMap.get(e.target);
      const active =
        isEndpointActive(sourceNode) && isEndpointActive(targetNode);
      const animated = active && dgNodes.length <= ANIMATION_NODE_LIMIT;

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "elk",
        data: { edgeType: e.type, active, animated, nodeCount: dgNodes.length },
        style: { stroke, strokeWidth: DEFAULT_EDGE_STROKE_WIDTH },
      };
    });
}
