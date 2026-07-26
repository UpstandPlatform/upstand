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

export const UpdateSwarmNodeInputSchema = z
  .object({
    nodeId: z.string().min(1, "Node ID is required"),
    version: z.number().int().positive("Node version is required"),
    availability: z.enum(["active", "drain", "pause"]).optional(),
    role: z.enum(["manager", "worker"]).optional(),
  })
  .refine((input) => input.availability || input.role, {
    message: "Provide an availability or role change.",
  });

export type UpdateSwarmNodeInput = z.infer<typeof UpdateSwarmNodeInputSchema>;

export class UpdateSwarmNodeUseCase {
  private readonly docker: Docker;

  constructor(docker?: Docker) {
    this.docker = docker || getDockerInstance();
  }

  async execute(input: UpdateSwarmNodeInput): Promise<{ success: boolean }> {
    try {
      const info = await requireActiveManager(this.docker);
      const node = this.docker.getNode(input.nodeId);
      const [inspect, nodes] = await Promise.all([
        node.inspect(),
        this.docker.listNodes() as Promise<DockerSwarmNode[]>,
      ]);

      if (inspect.Version?.Index !== input.version) {
        throw new ConflictError(
          "This node changed since it was loaded. Refresh the cluster before applying another change.",
        );
      }

      const nextRole = input.role || inspect.Spec?.Role || "worker";
      if (inspect.Spec?.Role === "manager" && nextRole === "worker") {
        assertSafeManagerRemoval(inspect, nodes, info.Swarm?.NodeID);
      }

      const nextSpec = {
        Name: inspect.Spec?.Name,
        Labels: inspect.Spec?.Labels || {},
        Role: nextRole,
        Availability:
          input.availability || inspect.Spec?.Availability || "active",
      };

      await node.update({
        version: input.version,
        ...nextSpec,
      });

      return { success: true };
    } catch (error) {
      if (error instanceof ConflictError || error instanceof ValidationError) {
        throw error;
      }
      throw dockerErrorMessage("Updating the Swarm node", error);
    }
  }
}
