import {
  type IUnitOfWork,
  type ServerBuildSettings,
  type UpdateServerBuildSettingsDTO,
  ValidationError,
} from "@upstand/domain";
import { redis } from "@upstand/redis";
import type { DockerInventoryReaderPort } from "../ports/docker";

export interface UpdateConcurrencyInput {
  organizationId: string;
  serverId: string;
  concurrency: number;
  hostname?: string;
  ip?: string;
  allowLocal?: boolean;
}

export interface RedisPublisher {
  publish(channel: string, message: string): Promise<number>;
}

export class UpdateConcurrencyUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly inventory: Pick<
      DockerInventoryReaderPort,
      "listSwarmNodes"
    >,
    private readonly redisPublisher: RedisPublisher = redis,
  ) {}

  async execute(input: UpdateConcurrencyInput): Promise<ServerBuildSettings> {
    if (
      !Number.isInteger(input.concurrency) ||
      input.concurrency < 1 ||
      input.concurrency > 100
    ) {
      throw new ValidationError(
        "Concurrency must be an integer between 1 and 100",
      );
    }

    if (!input.organizationId.trim()) {
      throw new ValidationError("Organization is required");
    }
    if (
      input.allowLocal === false &&
      ["local", "manager"].includes(input.serverId)
    ) {
      throw new ValidationError(
        "Cloud control planes can only configure concurrency for remote build servers",
      );
    }
    if (!["local", "manager"].includes(input.serverId)) {
      const server = await this.uow.serverRepository.findById(input.serverId);
      const isLocalSwarmNode = server
        ? false
        : await this.isLocalSwarmNode(input.serverId);
      if (input.allowLocal === false && !server) {
        throw new ValidationError(
          "Cloud control planes can only configure concurrency for remote build servers",
        );
      }
      if (
        (!server || server.organizationId !== input.organizationId) &&
        !isLocalSwarmNode
      ) {
        throw new ValidationError(
          "Build server is not part of the active organization",
        );
      }
      if (server?.serverType === "database") {
        throw new ValidationError(
          "Database servers cannot be used for application build concurrency",
        );
      }
    }

    const settings = await this.uow.transaction(async (tx) => {
      let settings = await tx.serverBuildSettingsRepository.findById(
        input.serverId,
      );
      if (!settings) {
        settings = await tx.serverBuildSettingsRepository.create({
          id: input.serverId,
          hostname: input.hostname || `Server ${input.serverId}`,
          ip: input.ip || "127.0.0.1",
          concurrency: input.concurrency,
        });
      } else {
        const patch: UpdateServerBuildSettingsDTO = {
          concurrency: input.concurrency,
        };
        if (input.hostname) patch.hostname = input.hostname;
        if (input.ip) patch.ip = input.ip;

        const updated = await tx.serverBuildSettingsRepository.updateById(
          input.serverId,
          patch,
        );
        if (!updated) {
          throw new Error("Failed to update server build settings");
        }
        settings = updated;
      }

      return settings;
    });

    try {
      await this.redisPublisher.publish(
        "upstand:server:concurrency",
        JSON.stringify({
          serverId: input.serverId,
          concurrency: input.concurrency,
        }),
      );
    } catch {
      // Best-effort pub-sub notification
    }
    return settings;
  }

  private async isLocalSwarmNode(serverId: string): Promise<boolean> {
    try {
      const nodes = await this.inventory.listSwarmNodes({
        kind: "local",
        name: "local",
      });
      return nodes.some((node) => node.id === serverId);
    } catch {
      return false;
    }
  }
}
