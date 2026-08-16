import { randomUUID } from "node:crypto";
import { environment, project, resource, secretVersion } from "@upstand/db";
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
import { MAX_REPOSITORY_READS } from "../shared/base.repository";
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
  if (!payload) {
    throw new Error("Secret version payload is not encrypted");
  }
  return decryptSecret(payload);
}

function encodeSecret(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined || value === "") return value;
  if (getEncryptedPayload(value)) return value;
  return JSON.stringify(encryptSecret(value));
}

const secretVersionMetadataSelection = {
  id: secretVersion.id,
  scopeType: secretVersion.scopeType,
  scopeId: secretVersion.scopeId,
  version: secretVersion.version,
  source: secretVersion.source,
  createdBy: secretVersion.createdBy,
  createdAt: secretVersion.createdAt,
};

const secretVersionPayloadSelection = {
  scopeType: secretVersion.scopeType,
  scopeId: secretVersion.scopeId,
  version: secretVersion.version,
  credentials: secretVersion.credentials,
  buildSecrets: secretVersion.buildSecrets,
  buildEnvVars: secretVersion.buildEnvVars,
  envVars: secretVersion.envVars,
  source: secretVersion.source,
  createdBy: secretVersion.createdBy,
};

export class DrizzleSecretVersionRepository
  implements ISecretVersionRepository
{
  constructor(private readonly executor: Executor) {}

  private async resolveOrganizationId(
    scopeType: SecretScopeType,
    scopeId: string,
  ): Promise<string> {
    const [row] =
      scopeType === "resource"
        ? await this.executor
            .select({ organizationId: project.organizationId })
            .from(resource)
            .innerJoin(environment, eq(resource.environmentId, environment.id))
            .innerJoin(project, eq(environment.projectId, project.id))
            .where(eq(resource.id, scopeId))
            .limit(1)
        : await this.executor
            .select({ organizationId: project.organizationId })
            .from(environment)
            .innerJoin(project, eq(environment.projectId, project.id))
            .where(eq(environment.id, scopeId))
            .limit(1);
    if (!row) throw new Error("Secret scope not found");
    return row.organizationId;
  }

  async findByScope(
    scopeType: SecretScopeType,
    scopeId: string,
    organizationId: string,
  ): Promise<SecretVersion[]> {
    if (scopeType === "resource") {
      const rows = await this.executor
        .select(secretVersionMetadataSelection)
        .from(secretVersion)
        .innerJoin(
          resource,
          and(
            eq(secretVersion.scopeType, "resource"),
            eq(secretVersion.scopeId, resource.id),
          ),
        )
        .innerJoin(environment, eq(resource.environmentId, environment.id))
        .innerJoin(project, eq(environment.projectId, project.id))
        .where(
          and(
            eq(secretVersion.scopeId, scopeId),
            eq(project.organizationId, organizationId),
          ),
        )
        .orderBy(desc(secretVersion.version))
        .limit(MAX_REPOSITORY_READS + 1);
      if (rows.length > MAX_REPOSITORY_READS) {
        throw new Error(
          "Secret version history exceeded the maximum supported row count",
        );
      }
      return rows as SecretVersion[];
    }

    const rows = await this.executor
      .select(secretVersionMetadataSelection)
      .from(secretVersion)
      .innerJoin(
        environment,
        and(
          eq(secretVersion.scopeType, "environment"),
          eq(secretVersion.scopeId, environment.id),
        ),
      )
      .innerJoin(project, eq(environment.projectId, project.id))
      .where(
        and(
          eq(secretVersion.scopeId, scopeId),
          eq(project.organizationId, organizationId),
        ),
      )
      .orderBy(desc(secretVersion.version))
      .limit(MAX_REPOSITORY_READS + 1);
    if (rows.length > MAX_REPOSITORY_READS) {
      throw new Error(
        "Secret version history exceeded the maximum supported row count",
      );
    }
    return rows as SecretVersion[];
  }

  async findByScopeVersion(
    scopeType: SecretScopeType,
    scopeId: string,
    version: number,
    organizationId: string,
  ): Promise<SecretVersionPayload | null> {
    const query =
      scopeType === "resource"
        ? this.executor
            .select(secretVersionPayloadSelection)
            .from(secretVersion)
            .innerJoin(
              resource,
              and(
                eq(secretVersion.scopeType, "resource"),
                eq(secretVersion.scopeId, resource.id),
              ),
            )
            .innerJoin(environment, eq(resource.environmentId, environment.id))
            .innerJoin(project, eq(environment.projectId, project.id))
            .where(
              and(
                eq(secretVersion.scopeId, scopeId),
                eq(secretVersion.version, version),
                eq(project.organizationId, organizationId),
              ),
            )
            .limit(1)
        : this.executor
            .select(secretVersionPayloadSelection)
            .from(secretVersion)
            .innerJoin(
              environment,
              and(
                eq(secretVersion.scopeType, "environment"),
                eq(secretVersion.scopeId, environment.id),
              ),
            )
            .innerJoin(project, eq(environment.projectId, project.id))
            .where(
              and(
                eq(secretVersion.scopeId, scopeId),
                eq(secretVersion.version, version),
                eq(project.organizationId, organizationId),
              ),
            )
            .limit(1);
    const [row] = await query;
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
    const organizationId = await this.resolveOrganizationId(
      payload.scopeType,
      payload.scopeId,
    );
    const [row] = await this.executor
      .insert(secretVersion)
      .values({
        id: randomUUID(),
        organizationId,
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
