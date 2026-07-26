import type {
  CreateServerBuildSettingsDTO,
  ServerBuildSettings,
  UpdateServerBuildSettingsDTO,
} from "../entities/server-build-settings";

export interface IServerBuildSettingsRepository {
  findById(id: string): Promise<ServerBuildSettings | null>;
  findMany(): Promise<ServerBuildSettings[]>;
  create(data: CreateServerBuildSettingsDTO): Promise<ServerBuildSettings>;
  createIfNotExists(
    data: CreateServerBuildSettingsDTO,
  ): Promise<ServerBuildSettings | null>;
  updateById(
    id: string,
    patch: UpdateServerBuildSettingsDTO,
  ): Promise<ServerBuildSettings | null>;
  deleteById(id: string): Promise<boolean>;
}
