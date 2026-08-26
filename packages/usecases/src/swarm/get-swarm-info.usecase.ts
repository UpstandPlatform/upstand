import {
  getConfiguredControlPlaneMode,
  getPlatformCapabilities,
} from "../platform/platform.types";
import type { DockerSwarmManagementPort } from "../ports/swarm";

export interface SwarmInfoResult {
  localNodeState: string;
  swarmId: string;
  nodeCount: number;
  isManager: boolean;
  controlAvailable: boolean;
  nodeId: string;
  nodeAddress: string;
  createdAt: string | null;
  updatedAt: string | null;
  dataPathPort: number | null;
  defaultAddressPools: string[];
  managers: number;
  activeManagers: number;
  error?: string;
}

export class GetSwarmInfoUseCase {
  private readonly docker: DockerSwarmManagementPort;

  constructor(docker: DockerSwarmManagementPort) {
    this.docker = docker;
  }

  async execute(): Promise<SwarmInfoResult> {
    const mode = getConfiguredControlPlaneMode();
    const capabilities = getPlatformCapabilities(mode);
    if (!capabilities.swarmManagement) {
      // Desktop / cloud mode: swarm clustering is not applicable.
      // Return a stable single-node inactive result so UI can surface
      // a graceful "not available" state without throwing.
      return {
        ...inactiveSwarmInfo("inactive"),
        localNodeState: `unavailable:${mode}`,
      };
    }

    try {
      const info = await this.docker.getInfo();

      if (info.localNodeState !== "active") {
        return inactiveSwarmInfo(info.localNodeState || "inactive");
      }

      const isControlPlane = info.controlAvailable;
      if (!isControlPlane) {
        return {
          localNodeState: info.localNodeState || "active",
          swarmId: "",
          nodeCount: info.nodeCount,
          isManager: false,
          controlAvailable: false,
          nodeId: info.nodeId,
          nodeAddress: info.nodeAddress,
          createdAt: null,
          updatedAt: null,
          dataPathPort: null,
          defaultAddressPools: [],
          managers: 0,
          activeManagers: 0,
        };
      }

      const [swarmInspect, nodes] = await Promise.all([
        this.docker.inspectSwarm(),
        this.docker.listNodes(),
      ]);
      const managers = nodes.filter((node) => node.role === "manager");

      return {
        localNodeState: info.localNodeState || "inactive",
        swarmId: swarmInspect.id,
        nodeCount: info.nodeCount,
        isManager: isControlPlane,
        controlAvailable: info.controlAvailable,
        nodeId: info.nodeId,
        nodeAddress: info.nodeAddress,
        createdAt: swarmInspect.createdAt,
        updatedAt: swarmInspect.updatedAt,
        dataPathPort: swarmInspect.dataPathPort,
        defaultAddressPools: swarmInspect.defaultAddressPools,
        managers: managers.length,
        activeManagers: managers.filter(
          (node) =>
            node.availability === "active" &&
            node.status === "ready" &&
            node.reachability !== "unreachable",
        ).length,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...inactiveSwarmInfo("error"),
        error: message,
      };
    }
  }
}

function inactiveSwarmInfo(localNodeState: string): SwarmInfoResult {
  return {
    localNodeState,
    swarmId: "",
    nodeCount: 0,
    isManager: false,
    controlAvailable: false,
    nodeId: "",
    nodeAddress: "",
    createdAt: null,
    updatedAt: null,
    dataPathPort: null,
    defaultAddressPools: [],
    managers: 0,
    activeManagers: 0,
  };
}
