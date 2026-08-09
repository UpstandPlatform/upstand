import { webServerSettings } from "@upstand/db";
import type {
  IWebServerSettingsRepository,
  UpdateWebServerSettingsDTO,
  WebServerSettings,
} from "@upstand/domain";
import {
  decryptSecret,
  type EncryptedPayload,
  encryptSecret,
} from "@upstand/platform/crypto/secret-box";
import { BaseRepository } from "../shared/base.repository";
import type { Executor } from "../shared/types";

function getEncryptedPayload(value: string): EncryptedPayload | null {
  try {
    const parsed = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.ciphertext === "string" &&
      typeof parsed.iv === "string" &&
      typeof parsed.authTag === "string" &&
      typeof parsed.keyVersion === "number"
    ) {
      return parsed as EncryptedPayload;
    }
  } catch {
    return null;
  }
  return null;
}

function decodeSecret(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined || value === "") return value;
  const payload = getEncryptedPayload(value);
  return payload ? decryptSecret(payload) : value;
}

function encodeSecret(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined || value === "") return value;
  if (getEncryptedPayload(value)) return value;
  return JSON.stringify(encryptSecret(value));
}

export class DrizzleWebServerSettingsRepository
  extends BaseRepository<
    typeof webServerSettings,
    WebServerSettings,
    typeof webServerSettings.$inferInsert
  >
  implements IWebServerSettingsRepository
{
  constructor(executor: Executor) {
    super(executor, webServerSettings);
  }

  private async publicRow(row: WebServerSettings): Promise<WebServerSettings> {
    const decodedToken = decodeSecret(row.cloudflareApiToken);
    if (
      row.cloudflareApiToken &&
      !getEncryptedPayload(row.cloudflareApiToken)
    ) {
      await super.updateById(row.id, {
        cloudflareApiToken: encodeSecret(row.cloudflareApiToken),
      });
    }
    return {
      ...row,
      cloudflareApiToken: decodedToken ?? row.cloudflareApiToken,
    };
  }

  override async findById(id: string): Promise<WebServerSettings | null> {
    const row = await super.findById(id);
    return row ? await this.publicRow(row) : null;
  }

  async findGlobal(): Promise<WebServerSettings | null> {
    return this.findById("global");
  }

  override async updateById(
    id: string,
    patch: Partial<UpdateWebServerSettingsDTO>,
  ): Promise<WebServerSettings | null> {
    const persisted = {
      ...patch,
      ...(patch.cloudflareApiToken !== undefined
        ? { cloudflareApiToken: encodeSecret(patch.cloudflareApiToken) }
        : {}),
    };
    const row = await super.updateById(id, persisted);
    return row ? await this.publicRow(row) : null;
  }

  async updateGlobal(
    patch: UpdateWebServerSettingsDTO,
  ): Promise<WebServerSettings | null> {
    return this.updateById("global", patch);
  }

  async createGlobal(data: {
    letsEncryptEmail?: string | null;
    cloudflareApiToken?: string | null;
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
  }): Promise<WebServerSettings> {
    try {
      const row = await this.create({
        id: "global",
        letsEncryptEmail: data.letsEncryptEmail ?? null,
        cloudflareApiToken: encodeSecret(data.cloudflareApiToken) ?? null,
        httpPort: data.httpPort ?? 80,
        httpsPort: data.httpsPort ?? 443,
        enableHttp3: data.enableHttp3 ?? true,
        globalCaddyfile: data.globalCaddyfile ?? null,
        caddySnippets: data.caddySnippets ?? "",
        caddyMiddlewares: data.caddyMiddlewares ?? "[]",
        serverIp: data.serverIp ?? null,
        dailyDockerCleanup: data.dailyDockerCleanup ?? false,
        caddyEnvironment: data.caddyEnvironment ?? "{}",
        caddyPorts: data.caddyPorts ?? "[]",
        caddyDashboardEnabled: data.caddyDashboardEnabled ?? false,
        accessLogsEnabled: data.accessLogsEnabled ?? false,
        ipAccessEnabled: data.ipAccessEnabled ?? true,
        accessLogCleanupCron: data.accessLogCleanupCron ?? "0 3 * * *",
      });
      return this.publicRow(row);
    } catch (error: unknown) {
      const existing = await this.findGlobal();
      if (existing) return existing;
      throw error;
    }
  }
}
