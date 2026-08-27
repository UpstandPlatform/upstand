export interface DockerSwarmInfoPort {
  localNodeState: string;
  controlAvailable: boolean;
  nodeId: string;
  nodeAddress: string;
  nodeCount: number;
}

export interface DockerSwarmInspectionPort {
  id: string;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  dataPathPort: number | null;
  defaultAddressPools: string[];
  workerJoinToken?: string;
  managerJoinToken?: string;
}

export interface DockerSwarmNodePort {
  id: string;
  hostname: string;
  role: string;
  labels: Record<string, string>;
  availability: string;
  status: string;
  ip: string;
  engineVersion: string;
  version: number;
  leader: boolean;
  managerAddr: string;
  reachability: string;
  isLocalNode: boolean;
}

export interface DockerSwarmServicePort {
  id: string;
  name: string;
}

export interface DockerSwarmTaskPort {
  id: string;
  serviceId?: string;
  nodeId?: string;
  slot: number;
  desiredState: string;
  currentState: string;
  message: string;
  updatedAt: string | null;
  image: string;
}

export interface DockerSwarmManagementPort {
  getInfo(): Promise<DockerSwarmInfoPort>;
  inspectSwarm(): Promise<DockerSwarmInspectionPort>;
  listNodes(): Promise<DockerSwarmNodePort[]>;
  listServices(): Promise<DockerSwarmServicePort[]>;
  listTasks(): Promise<DockerSwarmTaskPort[]>;
  initialize(input: {
    advertiseAddr: string;
    dataPathAddr?: string;
    defaultAddrPools: string[];
    subnetSize: number;
  }): Promise<void>;
  updateSwarm(input: {
    version: number;
    taskHistoryRetentionLimit?: number;
    rotateWorkerToken?: boolean;
    rotateManagerToken?: boolean;
  }): Promise<void>;
  inspectNode(nodeId: string): Promise<DockerSwarmNodePort>;
  updateNode(
    nodeId: string,
    input: {
      version: number;
      name: string;
      labels: Record<string, string>;
      role: "manager" | "worker";
      availability: "active" | "drain" | "pause";
    },
  ): Promise<void>;
  removeNode(nodeId: string, force: boolean): Promise<void>;
  ensureUpstandNetwork(): Promise<{ id: string; created: boolean }>;
}
