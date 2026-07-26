import type { IUnitOfWork } from "@upstand/domain";
import type { DockerInventoryReaderPort } from "../ports/docker";

export interface DeploymentServerSettingResult {
  id: string;
  hostname: string;
  ip: string;
  concurrency: number;
  status: string;
  serverType: string;
}

export class GetDeploymentServerSettingsUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly inventory: DockerInventoryReaderPort,
  ) {}

  async execute(
    organizationId: string,
  ): Promise<DeploymentServerSettingResult[]> {
    const nodes = await this.inventory.listSwarmNodes({
      kind: "local",
      name: "local",
    });
    const visibleNodes = nodes.length
      ? nodes
      : [
          {
            id: "local",
            hostname: "Upstand Server",
            ip: "127.0.0.1",
            isLeader: true,
          },
        ];
    const dbSettings = await this.uow.serverBuildSettingsRepository.findMany();
    const settingsMap = new Map(
      dbSettings.map((setting) => [setting.id, setting]),
    );
    const remoteServers =
      await this.uow.serverRepository.findByOrganizationId(organizationId);

    for (const server of remoteServers) {
      if (visibleNodes.some((node) => node.id === server.id)) continue;
      visibleNodes.push({
        id: server.id,
        hostname: server.name,
        ip: server.ipAddress,
        isLeader: false,
        status: server.status,
        serverType: server.serverType,
      });
    }

    return visibleNodes.map((node) => {
      const setting = settingsMap.get(node.id);
      return {
        id: node.id,
        hostname: setting?.hostname || node.hostname,
        ip: setting?.ip || node.ip,
        concurrency: setting?.concurrency || (node.isLeader ? 2 : 1),
        status: node.status || "ready",
        serverType: node.serverType || "swarm",
      };
    });
  }
}
