import type {
  MonitoringSettings,
  UpsertMonitoringSettingsDTO,
} from "../entities/monitoring-settings";

export interface IMonitoringSettingsRepository {
  findByServerId(serverId: string): Promise<MonitoringSettings | null>;
  findByToken(token: string): Promise<MonitoringSettings | null>;
  upsert(dto: UpsertMonitoringSettingsDTO): Promise<MonitoringSettings>;
}
