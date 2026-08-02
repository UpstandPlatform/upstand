import { serverBuildSettings } from "@upstand/db";
import type {
  CreateServerBuildSettingsDTO,
  IServerBuildSettingsRepository,
  ServerBuildSettings,
} from "@upstand/domain";
import { BaseRepository } from "../shared/base.repository";
import type { Executor } from "../shared/types";

const MAX_SERVER_BUILD_SETTINGS = 1_000;

export class DrizzleServerBuildSettingsRepository
  extends BaseRepository<
    typeof serverBuildSettings,
    ServerBuildSettings,
    CreateServerBuildSettingsDTO
  >
  implements IServerBuildSettingsRepository
{
  constructor(executor: Executor) {
    super(executor, serverBuildSettings);
  }

  async findMany(): Promise<ServerBuildSettings[]> {
    const rows = await super.findMany({ limit: MAX_SERVER_BUILD_SETTINGS + 1 });
    if (rows.length > MAX_SERVER_BUILD_SETTINGS) {
      throw new Error(
        "Server build settings exceeded the maximum supported server count",
      );
    }
    return rows;
  }

  async createIfNotExists(
    data: CreateServerBuildSettingsDTO,
  ): Promise<ServerBuildSettings | null> {
    const [row] = await this.executor
      .insert(serverBuildSettings)
      .values(data)
      .onConflictDoNothing()
      .returning();
    return (row as ServerBuildSettings | undefined) ?? this.findById(data.id);
  }
}
