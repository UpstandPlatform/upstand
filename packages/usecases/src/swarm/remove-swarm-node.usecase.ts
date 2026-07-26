import { ConflictError, ValidationError } from "@upstand/domain";
import type Docker from "dockerode";
import { z } from "zod";
import { getDockerInstance } from "../resource/docker-client";
import {
  assertSafeManagerRemoval,
  type DockerSwarmNode,
  dockerErrorMessage,
  requireActiveManager,
} from "./swarm.helpers";

export const RemoveSwarmNodeInputSchema = z.object({
  nodeId: z.string().min(1, "Node ID is required"),
  version: z.number().int().positive("Node version is required"),
  confirmation: z.string().trim().min(1, "Type the node hostname to confirm"),
});

export type RemoveSwarmNodeInput = z.infer<typeof RemoveSwarmNodeInputSchema>;

export class RemoveSwarmNodeUseCase {
  private readonly docker: Docker;

  constructor(docker?: Docker) {
    this.docker = docker || getDockerInstance();
  }

  async execute(input: RemoveSwarmNodeInput): Promise<{ success: boolean }> {
    try {
      const info = await requireActiveManager(this.docker);
      const node = this.docker.getNode(input.nodeId);
      const [inspect, nodes] = await Promise.all([
        node.inspect(),
        this.docker.listNodes() as Promise<DockerSwarmNode[]>,
      ]);
      const hostname =
        inspect.Description?.Hostname || inspect.Spec?.Name || inspect.ID;

      if (input.confirmation !== hostname) {
        throw new ValidationError(
          `Confirmation must exactly match the node hostname '${hostname}'.`,
        );
      }

      if (inspect.Version?.Index !== input.version) {
        throw new ConflictError(
          "This node changed since it was loaded. Refresh the cluster before removing it.",
        );
      }

      assertSafeManagerRemoval(inspect, nodes, info.Swarm?.NodeID);

      if (inspect.Spec?.Availability !== "drain") {
        await node.update({
          version: input.version,
          Name: inspect.Spec?.Name,
          Labels: inspect.Spec?.Labels || {},
          Role: inspect.Spec?.Role || "worker",
          Availability: "drain",
        });
      }

      await node.remove({ force: true });
      return { success: true };
    } catch (error) {
      if (error instanceof ConflictError || error instanceof ValidationError) {
        throw error;
      }
      throw dockerErrorMessage("Removing the Swarm node", error);
    }
  }
}
