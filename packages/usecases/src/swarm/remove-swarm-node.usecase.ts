import { ConflictError, ValidationError } from "@upstand/domain";
import { z } from "zod";
import type { DockerSwarmManagementPort } from "../ports/swarm";
import {
  assertActiveManager,
  assertSafeManagerRemoval,
  dockerErrorMessage,
} from "./swarm.helpers";

export const RemoveSwarmNodeInputSchema = z.object({
  nodeId: z.string().min(1, "Node ID is required"),
  version: z.number().int().positive("Node version is required"),
  confirmation: z.string().trim().min(1, "Type the node hostname to confirm"),
});

export type RemoveSwarmNodeInput = z.infer<typeof RemoveSwarmNodeInputSchema>;

export class RemoveSwarmNodeUseCase {
  private readonly docker: DockerSwarmManagementPort;

  constructor(docker: DockerSwarmManagementPort) {
    this.docker = docker;
  }

  async execute(input: RemoveSwarmNodeInput): Promise<{ success: boolean }> {
    try {
      const info = await this.docker.getInfo();
      assertActiveManager(info);
      const [inspect, nodes] = await Promise.all([
        this.docker.inspectNode(input.nodeId),
        this.docker.listNodes(),
      ]);
      const hostname = inspect.hostname;

      if (input.confirmation !== hostname) {
        throw new ValidationError(
          `Confirmation must exactly match the node hostname '${hostname}'.`,
        );
      }

      if (inspect.version !== input.version) {
        throw new ConflictError(
          "This node changed since it was loaded. Refresh the cluster before removing it.",
        );
      }

      assertSafeManagerRemoval(inspect, nodes, info.nodeId);

      if (inspect.availability !== "drain") {
        await this.docker.updateNode(input.nodeId, {
          version: input.version,
          name: inspect.hostname,
          labels: inspect.labels,
          role: inspect.role === "manager" ? "manager" : "worker",
          availability: "drain",
        });
      }

      await this.docker.removeNode(input.nodeId, true);
      return { success: true };
    } catch (error) {
      if (error instanceof ConflictError || error instanceof ValidationError) {
        throw error;
      }
      throw dockerErrorMessage("Removing the Swarm node", error);
    }
  }
}
