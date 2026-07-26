import { type IUnitOfWork, ValidationError } from "@upstand/domain";
import { log } from "evlog";
import { z } from "zod";
import { requestMonitoringAgent } from "./monitoring-agent.client";

export const GetServerHistoricalMetricsInputSchema = z.object({
  organizationId: z.string().min(1),
  serverId: z.string().min(1),
  limit: z
    .string()
    .regex(/^(all|[1-9]\d{0,3})$/)
    .optional()
    .default("50"),
  appName: z.string().trim().max(200).optional(),
  containerMetrics: z.boolean().optional().default(false),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type GetServerHistoricalMetricsInput = z.infer<
  typeof GetServerHistoricalMetricsInputSchema
>;

export class GetServerHistoricalMetricsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: GetServerHistoricalMetricsInput): Promise<unknown> {
    const serverId = input.serverId;

    const serverRecord =
      serverId === "local"
        ? null
        : await this.uow.serverRepository.findById(serverId);
    if (
      serverId !== "local" &&
      (!serverRecord || serverRecord.organizationId !== input.organizationId)
    ) {
      throw new ValidationError("Server not found");
    }

    const limit = input.limit ?? "50";
    const params = new URLSearchParams({ limit });
    if (input.appName) params.set("appName", input.appName);
    if (input.from) params.set("from", input.from);
    if (input.to) params.set("to", input.to);
    const endpoint =
      input.containerMetrics || input.appName
        ? "/metrics/containers"
        : "/metrics";
    if (input.from && input.to) {
      const from = new Date(input.from);
      const to = new Date(input.to);
      if (to <= from) {
        throw new Error("The monitoring end time must be after the start time");
      }
    }

    try {
      return await requestMonitoringAgent<unknown>(
        this.uow,
        serverId,
        endpoint,
        {
          query: params,
        },
      );
    } catch (err) {
      log.warn({
        message: `Failed to contact monitoring agent for ${serverId}`,
        err: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }
}
