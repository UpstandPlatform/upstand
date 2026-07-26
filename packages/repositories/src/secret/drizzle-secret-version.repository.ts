import { randomUUID } from "node:crypto";
import { secretVersion } from "@upstand/db";
import type {
  ISecretVersionRepository,
  SecretScopeType,
  SecretVersion,
  SecretVersionPayload,
} from "@upstand/domain";
import {
  decryptSecret,
  type EncryptedPayload,
  encryptSecret,
} from "@upstand/platform/crypto/secret-box";
import { and, desc, eq } from "drizzle-orm";
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

export class DrizzleSecretVersionRepository
  implements ISecretVersionRepository
{
  constructor(private readonly executor: Executor) {}

  async findByScope(
    scopeType: SecretScopeType,
    scopeId: string,
  ): Promise<SecretVersion[]> {
    return (await this.executor
      .select({
        id: secretVersion.id,
        scopeType: secretVersion.scopeType,
        scopeId: secretVersion.scopeId,
        version: secretVersion.version,
        source: secretVersion.source,
        createdBy: secretVersion.createdBy,
        createdAt: secretVersion.createdAt,
      })
      .from(secretVersion)
      .where(
        and(
          eq(secretVersion.scopeType, scopeType),
          eq(secretVersion.scopeId, scopeId),
        ),
      )
      .orderBy(desc(secretVersion.version))) as SecretVersion[];
  }

  async findByScopeVersion(
    scopeType: SecretScopeType,
    scopeId: string,
    version: number,
  ): Promise<SecretVersionPayload | null> {
    const [row] = await this.executor
      .select()
      .from(secretVersion)
      .where(
        and(
          eq(secretVersion.scopeType, scopeType),
          eq(secretVersion.scopeId, scopeId),
          eq(secretVersion.version, version),
        ),
      )
      .limit(1);
    return row
      ? {
          scopeType: row.scopeType as SecretScopeType,
          scopeId: row.scopeId,
          version: row.version,
          credentials: decodeSecret(row.credentials) ?? row.credentials,
          buildSecrets: decodeSecret(row.buildSecrets) ?? row.buildSecrets,
          buildEnvVars: decodeSecret(row.buildEnvVars) ?? row.buildEnvVars,
          envVars: decodeSecret(row.envVars) ?? row.envVars,
          source: row.source,
          createdBy: row.createdBy,
        }
      : null;
  }

  async append(payload: SecretVersionPayload): Promise<SecretVersion> {
    const [row] = await this.executor
      .insert(secretVersion)
      .values({
        id: randomUUID(),
        ...payload,
        credentials: encodeSecret(payload.credentials) ?? payload.credentials,
        buildSecrets:
          encodeSecret(payload.buildSecrets) ?? payload.buildSecrets,
        buildEnvVars:
          encodeSecret(payload.buildEnvVars) ?? payload.buildEnvVars,
        envVars: encodeSecret(payload.envVars) ?? payload.envVars,
      })
      .returning({
        id: secretVersion.id,
        scopeType: secretVersion.scopeType,
        scopeId: secretVersion.scopeId,
        version: secretVersion.version,
        source: secretVersion.source,
        createdBy: secretVersion.createdBy,
        createdAt: secretVersion.createdAt,
      });
    if (!row) throw new Error("secret version insert returned no row");
    return row as SecretVersion;
  }
}
