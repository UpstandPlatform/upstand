export interface PortMapping {
  host: number;
  container: number;
  protocol?: string;
}

export interface DGNode {
  id: string;
  type: "container" | "network" | "volume" | "server" | "swarm_node";
  name: string;
  image?: string;
  status?: string;
  ports?: PortMapping[];
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
  scope?: "managed" | "platform" | "external";
}

export interface DGEdge {
  id: string;
  type: "volume_mount" | "depends_on" | "secondary_network" | "server_host";
  source: string;
  target: string;
  mountPath?: string;
}

export interface ContainerNodeData {
  dgNode: DGNode;
  nodeWidth?: number;
  onInfoClick?: (id: string) => void;
}

export interface ServerNodeData {
  dgNode: DGNode;
  nodeWidth?: number;
  onInfoClick?: (id: string) => void;
}

export interface VolumeNodeData {
  dgNode: DGNode;
  nodeWidth?: number;
  onInfoClick?: (id: string) => void;
}

export interface NetworkGroupData {
  dgNode: DGNode;
  onInfoClick?: (id: string) => void;
}

export interface ElkEdgeData {
  path?: string;
  edgeType?: string;
  active?: boolean;
  animated?: boolean;
  nodeCount?: number;
}
