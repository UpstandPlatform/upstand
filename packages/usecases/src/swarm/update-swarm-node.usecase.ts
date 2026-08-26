import { ConflictError, ValidationError } from "@upstand/domain";
import { z } from "zod";
import type { DockerSwarmManagementPort } from "../ports/swarm";
import {
  assertActiveManager,
  assertSafeManagerRemoval,
  dockerErrorMessage,
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
  private readonly docker: DockerSwarmManagementPort;

  constructor(docker: DockerSwarmManagementPort) {
    this.docker = docker;
  }

  async execute(input: UpdateSwarmNodeInput): Promise<{ success: boolean }> {
    try {
      const info = await this.docker.getInfo();
      const [inspect, nodes] = await Promise.all([
        this.docker.inspectNode(input.nodeId),
        this.docker.listNodes(),
      ]);

      assertActiveManager(info);
      if (inspect.version !== input.version) {
        throw new ConflictError(
          "This node changed since it was loaded. Refresh the cluster before applying another change.",
        );
      }

      const nextRole = input.role || inspect.role || "worker";
      if (inspect.role === "manager" && nextRole === "worker") {
        assertSafeManagerRemoval(inspect, nodes, info.nodeId);
      }

      const nextSpec = {
        name: inspect.hostname,
        labels: inspect.labels,
        role: nextRole as "manager" | "worker",
        availability: (input.availability ||
          inspect.availability ||
          "active") as "active" | "drain" | "pause",
      };

      await this.docker.updateNode(input.nodeId, {
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
