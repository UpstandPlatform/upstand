import type { CreateServerDTO, Server } from "../entities/server.entity";

export interface ServerDeploymentDiscovery {
  id: string;
  serverType: Server["serverType"];
  status: Server["status"];
}

export interface ServerCleanupCandidate {
  id: string;
  name: string;
}

export interface IServerRepository {
  findById(id: string): Promise<Server | null>;
  findByOrganizationId(organizationId: string): Promise<Server[]>;
  findMany(): Promise<Server[]>;
  /**
   * Returns only the metadata needed by background deployment workers.
   * Implementations must bound this result and fail closed when the bound is
   * exceeded; the worker must not load server credentials just to discover IDs.
   */
  findDeploymentDiscovery?(): Promise<ServerDeploymentDiscovery[]>;
  /** Return only enabled remote-cleanup targets, without server credentials. */
  findCleanupCandidates?(): Promise<ServerCleanupCandidate[]>;
  create(data: CreateServerDTO): Promise<Server>;
  updateById(
    id: string,
    data: Partial<CreateServerDTO>,
  ): Promise<Server | null>;
  deleteById(id: string): Promise<boolean>;
}
