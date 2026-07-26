import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { z } from "zod";
import { requestMonitoringAgent } from "./monitoring-agent.client";

export const UpdateMonitoringSettingsInputSchema = z.object({
  organizationId: z.string().min(1),
  serverId: z.string().min(1),
  cpuThreshold: z.number().int().min(0).max(100),
  memoryThreshold: z.number().int().min(0).max(100),
});

export type UpdateMonitoringSettingsInput = z.infer<
  typeof UpdateMonitoringSettingsInputSchema
>;

export class UpdateMonitoringSettingsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: UpdateMonitoringSettingsInput) {
    const parsed = UpdateMonitoringSettingsInputSchema.parse(input);
    if (parsed.serverId !== "local") {
      const server = await this.uow.serverRepository.findById(parsed.serverId);
      if (!server || server.organizationId !== parsed.organizationId) {
        throw new ValidationError("Server not found");
      }
    }

    const existing = await this.uow.monitoringSettingsRepository.findByServerId(
      parsed.serverId,
    );
    if (!existing) {
      throw new ValidationError(
        "Monitoring is not configured for this server. Set up the server first.",
      );
    }

    const updated = await this.uow.monitoringSettingsRepository.upsert({
      serverId: parsed.serverId,
      cpuThreshold: parsed.cpuThreshold,
      memoryThreshold: parsed.memoryThreshold,
    });

    await requestMonitoringAgent(
      this.uow,
      parsed.serverId,
      "/config/thresholds",
      {
        method: "POST",
        body: {
          cpu: parsed.cpuThreshold,
          memory: parsed.memoryThreshold,
        },
      },
    );

    return {
      serverId: updated.serverId,
      cpuThreshold: updated.cpuThreshold,
      memoryThreshold: updated.memoryThreshold,
    };
  }
}
