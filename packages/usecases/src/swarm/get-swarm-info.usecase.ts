import type Docker from "dockerode";
import { getDockerInstance } from "../resource/docker-client";
import {
  type DockerSwarmInfo,
  type DockerSwarmNode,
  isManager,
  isSwarmActive,
} from "./swarm.helpers";

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
  private readonly docker: Docker;

  constructor(docker?: Docker) {
    this.docker = docker || getDockerInstance();
  }

  async execute(): Promise<SwarmInfoResult> {
    try {
      const info = (await this.docker.info()) as DockerSwarmInfo;
      const swarmInfo = info.Swarm;

      if (!isSwarmActive(info)) {
        return inactiveSwarmInfo(swarmInfo?.LocalNodeState || "inactive");
      }
      if (!swarmInfo) {
        return inactiveSwarmInfo("inactive");
      }

      const isControlPlane = isManager(info);
      if (!isControlPlane) {
        return {
          localNodeState: swarmInfo.LocalNodeState || "active",
          swarmId: "",
          nodeCount: swarmInfo.Nodes || 0,
          isManager: false,
          controlAvailable: false,
          nodeId: swarmInfo.NodeID || "",
          nodeAddress: swarmInfo.NodeAddr || "",
          createdAt: null,
          updatedAt: null,
          dataPathPort: null,
          defaultAddressPools: [],
          managers: 0,
          activeManagers: 0,
        };
      }

      const [swarmInspect, nodes] = await Promise.all([
        this.docker.swarmInspect(),
        this.docker.listNodes() as Promise<DockerSwarmNode[]>,
      ]);
      const managers = nodes.filter((node) => node.Spec?.Role === "manager");

      return {
        localNodeState: swarmInfo.LocalNodeState || "inactive",
        swarmId: swarmInspect.ID || "",
        nodeCount: swarmInfo?.Nodes || 0,
        isManager: isControlPlane,
        controlAvailable: swarmInfo?.ControlAvailable || false,
        nodeId: swarmInfo?.NodeID || "",
        nodeAddress: swarmInfo?.NodeAddr || "",
        createdAt: swarmInspect.CreatedAt || null,
        updatedAt: swarmInspect.UpdatedAt || null,
        dataPathPort: swarmInspect.DataPathPort || null,
        defaultAddressPools: swarmInspect.DefaultAddrPool || [],
        managers: managers.length,
        activeManagers: managers.filter(
          (node) =>
            node.Spec?.Availability === "active" &&
            node.Status?.State === "ready" &&
            node.ManagerStatus?.Reachability !== "unreachable",
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
