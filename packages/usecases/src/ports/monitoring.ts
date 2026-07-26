import type { IUnitOfWork } from "@upstand/domain";

export interface MonitoringAgentPort {
  request<T>(
    uow: IUnitOfWork,
    serverId: string,
    endpoint: string,
    options?: {
      method?: "GET" | "POST";
      query?: URLSearchParams;
      body?: Record<string, unknown>;
    },
  ): Promise<T>;
}
