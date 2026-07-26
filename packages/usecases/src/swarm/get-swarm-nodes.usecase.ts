import type Docker from "dockerode";
import { getDockerInstance } from "../resource/docker-client";
import { type DockerSwarmNode, requireActiveManager } from "./swarm.helpers";

export interface SwarmNodeResult {
  id: string;
  hostname: string;
  role: string;
  status: string;
  availability: string;
  ip: string;
  engineVersion: string;
  version: number;
  leader: boolean;
  managerAddr: string;
  reachability: string;
  isLocalNode: boolean;
}

export class GetSwarmNodesUseCase {
  private readonly docker: Docker;

  constructor(docker?: Docker) {
    this.docker = docker || getDockerInstance();
  }

  async execute(): Promise<SwarmNodeResult[]> {
    const info = await requireActiveManager(this.docker);
    const nodes = (await this.docker.listNodes()) as DockerSwarmNode[];

    return nodes
      .map((node) => ({
        id: node.ID,
        hostname: node.Description?.Hostname || node.Spec?.Name || node.ID,
        role: node.Spec?.Role || "worker",
        status: node.Status?.State || "unknown",
        availability: node.Spec?.Availability || "active",
        ip: node.Status?.Addr || "",
        engineVersion: node.Description?.Engine?.EngineVersion || "unknown",
        version: node.Version?.Index || 0,
        leader: node.ManagerStatus?.Leader === true,
        managerAddr: node.ManagerStatus?.Addr || "",
        reachability: node.ManagerStatus?.Reachability || "",
        isLocalNode: node.ID === info.Swarm?.NodeID,
      }))
      .sort((left, right) => {
        if (left.leader !== right.leader) return left.leader ? -1 : 1;
        if (left.role !== right.role) return left.role === "manager" ? -1 : 1;
        return left.hostname.localeCompare(right.hostname);
      });
  }
}
