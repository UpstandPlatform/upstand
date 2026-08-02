import { ConflictError, ValidationError } from "@upstand/domain";
import { env } from "@upstand/env/server";
import type Docker from "dockerode";
import { z } from "zod";
import {
  getConfiguredControlPlaneMode,
  getPlatformCapabilities,
} from "../platform/platform.types";
import { getDockerInstance } from "../resource/docker-client";
import {
  ensureUpstandOverlayNetwork,
  isSwarmActive,
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
  private readonly docker: Docker;

  constructor(docker?: Docker) {
    this.docker = docker || getDockerInstance();
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
      const info = await this.docker.info();
      if (isSwarmActive(info)) {
        throw new ConflictError("Docker Swarm is already active on this node.");
      }

      await this.docker.swarmInit({
        AdvertiseAddr: advertiseAddr,
        ListenAddr: "0.0.0.0:2377",
        ...(dataPathAddr ? { DataPathAddr: dataPathAddr } : {}),
        DefaultAddrPool: defaultAddrPools,
        SubnetSize: subnetSize,
      });

      const [swarm, network] = await Promise.all([
        this.docker.swarmInspect(),
        ensureUpstandOverlayNetwork(this.docker),
      ]);

      if (swarm.Version?.Index) {
        await this.docker.swarmUpdate({
          version: swarm.Version.Index,
          Spec: {
            Orchestration: {
              TaskHistoryRetentionLimit: 1,
            },
          },
        });
      }

      return {
        swarmId: swarm.ID,
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
