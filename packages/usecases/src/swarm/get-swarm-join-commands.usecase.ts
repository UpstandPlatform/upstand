import type { DockerSwarmManagementPort } from "../ports/swarm";
import { assertActiveManager, formatSwarmEndpoint } from "./swarm.helpers";

export interface SwarmJoinCommandsResult {
  advertiseAddress: string;
  workerCommand: string;
  managerCommand: string;
}

export class GetSwarmJoinCommandsUseCase {
  private readonly docker: DockerSwarmManagementPort;

  constructor(docker: DockerSwarmManagementPort) {
    this.docker = docker;
  }

  async execute(): Promise<SwarmJoinCommandsResult> {
    const [info, swarm] = await Promise.all([
      this.docker.getInfo(),
      this.docker.inspectSwarm(),
    ]);
    assertActiveManager(info);
    const address = info.nodeAddress;

    if (!address || !swarm.workerJoinToken || !swarm.managerJoinToken) {
      throw new Error("Docker did not provide the Swarm join credentials.");
    }

    const endpoint = formatSwarmEndpoint(address);
    return {
      advertiseAddress: address,
      workerCommand: `docker swarm join --token ${swarm.workerJoinToken} ${endpoint}`,
      managerCommand: `docker swarm join --token ${swarm.managerJoinToken} ${endpoint}`,
    };
  }
}
