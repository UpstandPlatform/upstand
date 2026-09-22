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
    private readonly inventory: Pick<
      DockerInventoryReaderPort,
      "listSwarmNodes"
    >,
  ) {}

  async execute(
    organizationId: string,
    options: { includeLocal?: boolean } = {},
  ): Promise<DeploymentServerSettingResult[]> {
    // Cloud control planes have no local Docker socket, so the local inventory
    // must not be probed at all there; probing it would turn an unreachable
    // daemon into a failed settings query instead of an empty local section.
    // Where the probe does run, an unreachable daemon must still leave the
    // remote servers listable rather than failing the whole query.
    const nodes =
      options.includeLocal === false
        ? []
        : await this.inventory
            .listSwarmNodes({ kind: "local", name: "local" })
            .catch(() => []);
    const visibleNodes =
      options.includeLocal === false
        ? []
        : nodes.length
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
      if (server.serverType === "database") continue;
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
