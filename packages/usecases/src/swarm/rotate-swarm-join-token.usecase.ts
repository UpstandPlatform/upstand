import { ValidationError } from "@upstand/domain";
import { z } from "zod";
import type { DockerSwarmManagementPort } from "../ports/swarm";
import {
  assertActiveManager,
  dockerErrorMessage,
  formatSwarmEndpoint,
} from "./swarm.helpers";

export const RotateSwarmJoinTokenInputSchema = z.object({
  role: z.enum(["worker", "manager"]),
});

export type RotateSwarmJoinTokenInput = z.infer<
  typeof RotateSwarmJoinTokenInputSchema
>;

export class RotateSwarmJoinTokenUseCase {
  private readonly docker: DockerSwarmManagementPort;

  constructor(docker: DockerSwarmManagementPort) {
    this.docker = docker;
  }

  async execute(input: RotateSwarmJoinTokenInput): Promise<{
    role: RotateSwarmJoinTokenInput["role"];
    command: string;
  }> {
    try {
      const [info, swarm] = await Promise.all([
        this.docker.getInfo(),
        this.docker.inspectSwarm(),
      ]);
      assertActiveManager(info);

      await this.docker.updateSwarm({
        version: swarm.version,
        ...(input.role === "worker"
          ? { rotateWorkerToken: true }
          : { rotateManagerToken: true }),
      });

      const refreshed = await this.docker.inspectSwarm();
      const address = info.nodeAddress;
      const token =
        input.role === "worker"
          ? refreshed.workerJoinToken
          : refreshed.managerJoinToken;

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
