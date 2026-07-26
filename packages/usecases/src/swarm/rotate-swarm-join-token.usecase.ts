import { ValidationError } from "@upstand/domain";
import type Docker from "dockerode";
import { z } from "zod";
import { getDockerInstance } from "../resource/docker-client";
import {
  dockerErrorMessage,
  formatSwarmEndpoint,
  requireActiveManager,
} from "./swarm.helpers";

export const RotateSwarmJoinTokenInputSchema = z.object({
  role: z.enum(["worker", "manager"]),
});

export type RotateSwarmJoinTokenInput = z.infer<
  typeof RotateSwarmJoinTokenInputSchema
>;

export class RotateSwarmJoinTokenUseCase {
  private readonly docker: Docker;

  constructor(docker?: Docker) {
    this.docker = docker || getDockerInstance();
  }

  async execute(input: RotateSwarmJoinTokenInput): Promise<{
    role: RotateSwarmJoinTokenInput["role"];
    command: string;
  }> {
    try {
      const [info, swarm] = await Promise.all([
        requireActiveManager(this.docker),
        this.docker.swarmInspect(),
      ]);

      await this.docker.swarmUpdate({
        version: swarm.Version?.Index,
        ...(input.role === "worker"
          ? { RotateWorkerToken: true }
          : { RotateManagerToken: true }),
      });

      const refreshed = await this.docker.swarmInspect();
      const address = info.Swarm?.NodeAddr;
      const token =
        input.role === "worker"
          ? refreshed.JoinTokens?.Worker
          : refreshed.JoinTokens?.Manager;

      if (!address || !token) {
        throw new ValidationError(
          "Docker did not provide the rotated join token.",
        );
      }

      return {
        role: input.role,
        command: `docker swarm join --token ${token} ${formatSwarmEndpoint(address)}`,
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw dockerErrorMessage("Rotating the Swarm join token", error);
    }
  }
}
