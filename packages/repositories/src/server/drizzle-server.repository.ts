import { server } from "@upstand/db";
import type {
  CreateServerDTO,
  IServerRepository,
  Server,
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
}
