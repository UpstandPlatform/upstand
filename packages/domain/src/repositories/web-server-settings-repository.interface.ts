import type {
  UpdateWebServerSettingsDTO,
  WebServerSettings,
} from "../entities/web-server-settings";

export interface IWebServerSettingsRepository {
  findGlobal(): Promise<WebServerSettings | null>;
  updateGlobal(
    patch: UpdateWebServerSettingsDTO,
  ): Promise<WebServerSettings | null>;
  createGlobal(data: {
    letsEncryptEmail?: string | null;
    httpPort?: number;
    httpsPort?: number;
    enableHttp3?: boolean;
    globalCaddyfile?: string | null;
    caddySnippets?: string;
    caddyMiddlewares?: string;
    serverIp?: string | null;
    dailyDockerCleanup?: boolean;
    caddyEnvironment?: string;
    caddyPorts?: string;
    caddyDashboardEnabled?: boolean;
    accessLogsEnabled?: boolean;
    ipAccessEnabled?: boolean;
    accessLogCleanupCron?: string;
  }): Promise<WebServerSettings>;
}
