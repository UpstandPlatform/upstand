import { server } from "@upstand/db";
import type {
  CreateServerDTO,
  IServerRepository,
  Server,
  ServerCleanupCandidate,
  ServerDeploymentDiscovery,
} from "@upstand/domain";
import { eq } from "drizzle-orm";
import { BaseRepository } from "../shared/base.repository";
import type { Executor } from "../shared/types";

export class DrizzleServerRepository
  extends BaseRepository<typeof server, Server, CreateServerDTO>
  implements IServerRepository
{
  constructor(executor: Executor) {
    super(executor, server);
  }

  async findByOrganizationId(organizationId: string): Promise<Server[]> {
    return this.findMany({
      where: eq(server.organizationId, organizationId),
    });
  }

  async findDeploymentDiscovery(): Promise<ServerDeploymentDiscovery[]> {
    const maxRows = 1_001;
    const rows = await this.executor
      .select({
        id: server.id,
        serverType: server.serverType,
        status: server.status,
      })
      .from(server)
      .limit(maxRows);

    if (rows.length >= maxRows) {
      throw new Error(
        "Server discovery exceeded the maximum supported server count",
      );
    }

    return rows as ServerDeploymentDiscovery[];
  }

  async findCleanupCandidates(): Promise<ServerCleanupCandidate[]> {
    const maxRows = 1_001;
    const rows = await this.executor
      .select({ id: server.id, name: server.name })
      .from(server)
      .where(eq(server.enableDockerCleanup, true))
      .limit(maxRows);

    if (rows.length >= maxRows) {
      throw new Error(
        "Scheduled Docker cleanup exceeded the maximum supported server count",
      );
    }

    return rows;
  }
}
