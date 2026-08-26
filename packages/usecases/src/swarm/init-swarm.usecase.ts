import { ConflictError, ValidationError } from "@upstand/domain";
import { env } from "@upstand/env/server";
import { z } from "zod";
import {
  getConfiguredControlPlaneMode,
  getPlatformCapabilities,
} from "../platform/platform.types";
import type { DockerSwarmManagementPort } from "../ports/swarm";
import {
  validateSwarmAddress,
  validateSwarmAddressPools,
} from "./swarm.helpers";

const DEFAULT_ADDRESS_POOLS = ["10.20.0.0/16", "10.21.0.0/16"];

export const InitSwarmInputSchema = z.object({
  advertiseAddr: z.string().trim().min(1, "Advertise address is required"),
  dataPathAddr: z.string().trim().min(1).optional(),
  defaultAddrPools: z
    .array(
      z
        .string()
        .regex(
          /^[0-9a-fA-F:.]+\/[0-9]{1,3}$/,
          "Each default address pool must be a CIDR range.",
        ),
    )
    .min(1)
    .max(8)
    .default(DEFAULT_ADDRESS_POOLS),
  subnetSize: z.number().int().min(16).max(28).default(24),
});

export type InitSwarmInput = z.infer<typeof InitSwarmInputSchema>;

export class InitSwarmUseCase {
  private readonly docker: DockerSwarmManagementPort;

  constructor(docker: DockerSwarmManagementPort) {
    this.docker = docker;
  }

  async execute(input: InitSwarmInput): Promise<{
    swarmId: string;
    networkName: string;
    networkCreated: boolean;
  }> {
    const mode = getConfiguredControlPlaneMode();
    const capabilities = getPlatformCapabilities(mode);
    if (!capabilities.swarmManagement) {
      throw new ValidationError(
        `Docker Swarm cluster management is not available in '${mode}' mode. ` +
          "Swarm is only supported in self-hosted deployments.",
      );
    }

    const advertiseAddr = validateSwarmAddress(
      input.advertiseAddr,
      "Advertise address",
    );
    const dataPathAddr = input.dataPathAddr
      ? validateSwarmAddress(input.dataPathAddr, "Data path address")
      : undefined;
    const subnetSize = input.subnetSize ?? 24;
    const defaultAddrPools = validateSwarmAddressPools(
      input.defaultAddrPools || DEFAULT_ADDRESS_POOLS,
      subnetSize,
    );

    try {
      const info = await this.docker.getInfo();
      if (info.localNodeState === "active") {
        throw new ConflictError("Docker Swarm is already active on this node.");
      }

      await this.docker.initialize({
        advertiseAddr,
        ...(dataPathAddr ? { dataPathAddr } : {}),
        defaultAddrPools,
        subnetSize,
      });

      const [swarm, network] = await Promise.all([
        this.docker.inspectSwarm(),
        this.docker.ensureUpstandNetwork(),
      ]);

      if (swarm.version) {
        await this.docker.updateSwarm({
          version: swarm.version,
          taskHistoryRetentionLimit: 1,
        });
      }

      return {
        swarmId: swarm.id,
        networkName: env.DOCKER_NETWORK || "upstand-network",
        networkCreated: network.created,
      };
    } catch (error) {
      if (error instanceof ConflictError || error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        `Failed to initialize Docker Swarm: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
