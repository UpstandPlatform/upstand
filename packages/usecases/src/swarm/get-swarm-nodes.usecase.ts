import type { DockerSwarmManagementPort } from "../ports/swarm";
import { assertActiveManager } from "./swarm.helpers";

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
  private readonly docker: DockerSwarmManagementPort;

  constructor(docker: DockerSwarmManagementPort) {
    this.docker = docker;
  }

  async execute(): Promise<SwarmNodeResult[]> {
    const info = await this.docker.getInfo();
    assertActiveManager(info);
    const nodes = await this.docker.listNodes();

    return nodes
      .map((node) => ({
        id: node.id,
        hostname: node.hostname,
        role: node.role,
        status: node.status,
        availability: node.availability,
        ip: node.ip,
        engineVersion: node.engineVersion,
        version: node.version,
        leader: node.leader,
        managerAddr: node.managerAddr,
        reachability: node.reachability,
        isLocalNode: node.isLocalNode,
      }))
      .sort((left, right) => {
        if (left.leader !== right.leader) return left.leader ? -1 : 1;
        if (left.role !== right.role) return left.role === "manager" ? -1 : 1;
        return left.hostname.localeCompare(right.hostname);
      });
  }
}
