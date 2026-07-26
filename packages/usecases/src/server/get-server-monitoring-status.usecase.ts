import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { z } from "zod";
import { requestMonitoringAgent } from "./monitoring-agent.client";

export const GetServerMonitoringStatusInputSchema = z.object({
  organizationId: z.string().min(1),
  serverId: z.string().min(1),
});

export type GetServerMonitoringStatusInput = z.infer<
  typeof GetServerMonitoringStatusInputSchema
>;

export type ServerMonitoringStatus = {
  serverId: string;
  reachable: boolean;
  status: "healthy" | "unhealthy" | "not_configured";
  lastCollectedAt?: string;
  collectionError?: string;
};

export class GetServerMonitoringStatusUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: GetServerMonitoringStatusInput,
  ): Promise<ServerMonitoringStatus> {
    const parsed = GetServerMonitoringStatusInputSchema.parse(input);
    if (parsed.serverId !== "local") {
      const server = await this.uow.serverRepository.findById(parsed.serverId);
      if (!server || server.organizationId !== parsed.organizationId) {
        throw new ValidationError("Server not found");
      }
    }

    if (
      !(await this.uow.monitoringSettingsRepository.findByServerId(
        parsed.serverId,
      ))
    ) {
      return {
        serverId: parsed.serverId,
        reachable: false,
        status: "not_configured",
      };
    }

    try {
      const health = await requestMonitoringAgent<{
        status?: string;
        lastCollectedAt?: string;
        collectionError?: string;
      }>(this.uow, parsed.serverId, "/health");
      return {
        serverId: parsed.serverId,
        reachable: true,
        status: health.status === "ok" ? "healthy" : "unhealthy",
        lastCollectedAt: health.lastCollectedAt,
        collectionError: health.collectionError,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const collectionError = message.startsWith(
        "Failed to contact monitoring agent",
      )
        ? message
        : `Failed to contact monitoring agent for ${parsed.serverId}: ${message}`;
      return {
        serverId: parsed.serverId,
        reachable: false,
        status: "unhealthy",
        collectionError,
      };
    }
  }
}
