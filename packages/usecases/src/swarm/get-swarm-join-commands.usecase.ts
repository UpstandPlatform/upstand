import type Docker from "dockerode";
import { getDockerInstance } from "../resource/docker-client";
import { formatSwarmEndpoint, requireActiveManager } from "./swarm.helpers";

export interface SwarmJoinCommandsResult {
  advertiseAddress: string;
  workerCommand: string;
  managerCommand: string;
}

export class GetSwarmJoinCommandsUseCase {
  private readonly docker: Docker;

  constructor(docker?: Docker) {
    this.docker = docker || getDockerInstance();
  }

  async execute(): Promise<SwarmJoinCommandsResult> {
    const [info, swarm] = await Promise.all([
      requireActiveManager(this.docker),
      this.docker.swarmInspect(),
    ]);
    const address = info.Swarm?.NodeAddr;

    if (!address || !swarm.JoinTokens?.Worker || !swarm.JoinTokens?.Manager) {
      throw new Error("Docker did not provide the Swarm join credentials.");
    }

    const endpoint = formatSwarmEndpoint(address);
    return {
      advertiseAddress: address,
      workerCommand: `docker swarm join --token ${swarm.JoinTokens.Worker} ${endpoint}`,
      managerCommand: `docker swarm join --token ${swarm.JoinTokens.Manager} ${endpoint}`,
    };
  }
}
