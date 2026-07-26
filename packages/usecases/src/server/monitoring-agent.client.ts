import type { IUnitOfWork } from "@upstand/domain";
import type { MonitoringAgentPort } from "../ports/monitoring";

let client: MonitoringAgentPort = {
  request: async () => {
    throw new Error("Monitoring infrastructure has not been configured");
  },
};

export function configureMonitoringAgent(next: MonitoringAgentPort): void {
  client = next;
}

export function requestMonitoringAgent<T>(
  uow: IUnitOfWork,
  serverId: string,
  endpoint: string,
  options?: Parameters<MonitoringAgentPort["request"]>[3],
): Promise<T> {
  return client.request<T>(uow, serverId, endpoint, options);
}
