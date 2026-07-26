import { monitoringSettings } from "@upstand/db";
import type {
  IMonitoringSettingsRepository,
  MonitoringSettings,
  UpsertMonitoringSettingsDTO,
} from "@upstand/domain";
import { decryptSecret, encryptSecret } from "@upstand/platform";
import { eq } from "drizzle-orm";
import type { Executor } from "../shared/types";

function decodeToken(value: string): string {
  try {
    const payload = JSON.parse(value) as {
      ciphertext?: unknown;
      iv?: unknown;
      authTag?: unknown;
      keyVersion?: unknown;
    };
    if (
      typeof payload.ciphertext === "string" &&
      typeof payload.iv === "string" &&
      typeof payload.authTag === "string" &&
      typeof payload.keyVersion === "number"
    ) {
      return decryptSecret(payload as Parameters<typeof decryptSecret>[0]);
    }
  } catch {
    // Existing installations may contain a legacy plaintext token.
  }
  return value;
}

function encodeToken(value: string): string {
  return JSON.stringify(encryptSecret(value));
}

export class DrizzleMonitoringSettingsRepository
  implements IMonitoringSettingsRepository
{
  constructor(private readonly executor: Executor) {}

  async findByServerId(serverId: string): Promise<MonitoringSettings | null> {
    const [row] = await this.executor
      .select()
      .from(monitoringSettings)
      .where(eq(monitoringSettings.serverId, serverId))
      .limit(1);
    return row ? { ...row, token: decodeToken(row.token) } : null;
  }

  async findByToken(token: string): Promise<MonitoringSettings | null> {
    const rows = await this.executor.select().from(monitoringSettings);
    const row = rows.find(
      (candidate) => decodeToken(candidate.token) === token,
    );
    return row ? { ...row, token: decodeToken(row.token) } : null;
  }

  async upsert(dto: UpsertMonitoringSettingsDTO): Promise<MonitoringSettings> {
    const [row] = await this.executor
      .insert(monitoringSettings)
      .values({
        serverId: dto.serverId,
        token: dto.token ? encodeToken(dto.token) : "",
        cpuThreshold: dto.cpuThreshold ?? 90,
        memoryThreshold: dto.memoryThreshold ?? 90,
        alertEmail: dto.alertEmail || null,
      })
      .onConflictDoUpdate({
        target: monitoringSettings.serverId,
        set: {
          ...(dto.token ? { token: encodeToken(dto.token) } : {}),
          cpuThreshold: dto.cpuThreshold,
          memoryThreshold: dto.memoryThreshold,
          alertEmail: dto.alertEmail,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!row) {
      throw new Error("upsert: insert/update returned no rows");
    }
    return { ...row, token: decodeToken(row.token) };
  }
}
