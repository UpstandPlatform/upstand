import type {
  ControlPlaneTransferManifest,
  PortableControlPlaneRecord,
} from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import { eq, getTableColumns } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { PortableControlPlaneRecordApplier } from "./drizzle-control-plane-import.destination";
import {
  PORTABLE_ENTITY_BY_NAME,
  PORTABLE_ENTITY_CATALOG,
  type PortableEntityDefinition,
  type PortableSecretStorage,
} from "./portable-entity-catalog";

type ControlPlaneTransaction = Parameters<
  PortableControlPlaneRecordApplier["applyRecord"]
>[0];
type EncryptedSecrets = Parameters<
  PortableControlPlaneRecordApplier["applySecrets"]
>[1];

function recordPayload(record: PortableControlPlaneRecord): {
  definition: PortableEntityDefinition;
  physicalId: string;
  values: Record<string, unknown>;
} {
  const entity = record.data.entity;
  const rawValues = record.data.values;
  if (
    typeof entity !== "string" ||
    !rawValues ||
    typeof rawValues !== "object" ||
    Array.isArray(rawValues)
  ) {
    throw new Error(`Portable record '${record.id}' has an invalid payload`);
  }
  const definition = PORTABLE_ENTITY_BY_NAME.get(entity);
  if (!definition || definition.portableTable !== record.table) {
    throw new Error(`Portable record '${record.id}' has an unknown entity`);
  }
  const prefix = `${definition.name}:`;
  if (!record.id.startsWith(prefix) || record.id.length === prefix.length) {
    throw new Error(`Portable record '${record.id}' has an invalid identity`);
  }
  const physicalId = record.id.slice(prefix.length);
  const values = rawValues as Record<string, unknown>;
  if (values[definition.idField] !== physicalId) {
    throw new Error(`Portable record '${record.id}' identity does not match`);
  }
  return {
    definition,
    physicalId,
    values,
  };
}

function encryptedColumns(
  storage: PortableSecretStorage,
  payload: EncryptedSecrets[string],
): Record<string, unknown> {
  if (storage.kind === "json") {
    return { [storage.column]: JSON.stringify(payload) };
  }
  return {
    [storage.ciphertext]: payload.ciphertext,
    [storage.iv]: payload.iv,
    [storage.authTag]: payload.authTag,
    [storage.keyVersion]: payload.keyVersion,
  };
}

function placeholderColumns(
  definition: PortableEntityDefinition,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const storage of Object.values(definition.secrets)) {
    if (storage.required) {
      Object.assign(
        values,
        encryptedColumns(storage, encryptSecret(storage.fallback)),
      );
    }
  }
  return values;
}

function restoreValues(
  definition: PortableEntityDefinition,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const columns = getTableColumns(definition.table);
  const restored: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const column = columns[key];
    if (!column || definition.omit.includes(key)) {
      throw new Error(
        `Portable entity '${definition.name}' contains unsupported field '${key}'`,
      );
    }
    restored[key] =
      column.dataType === "date" && typeof value === "string"
        ? new Date(value)
        : value;
  }
  return { ...restored, ...placeholderColumns(definition) };
}

function comparable(
  definition: PortableEntityDefinition,
  values: Readonly<Record<string, unknown>>,
): string {
  const selected = Object.fromEntries(
    Object.keys(values)
      .sort()
      .map((key) => {
        const value = values[key];
        return [key, value instanceof Date ? value.toISOString() : value];
      }),
  );
  return JSON.stringify({ entity: definition.name, values: selected });
}

function parseSecretKey(key: string): {
  definition: PortableEntityDefinition;
  physicalId: string;
  storage: PortableSecretStorage;
} | null {
  const firstSlash = key.indexOf("/");
  const lastSlash = key.lastIndexOf("/");
  if (firstSlash <= 0 || lastSlash <= firstSlash) return null;
  const definition = PORTABLE_ENTITY_BY_NAME.get(key.slice(0, firstSlash));
  if (!definition) return null;
  let physicalId: string;
  try {
    physicalId = decodeURIComponent(key.slice(firstSlash + 1, lastSlash));
  } catch {
    return null;
  }
  const storage = definition.secrets[key.slice(lastSlash + 1)];
  return storage ? { definition, physicalId, storage } : null;
}

export class DrizzlePortableControlPlaneRecordApplier
  implements PortableControlPlaneRecordApplier
{
  private readonly acceptedIdentities = new Set<string>();

  async prepareReplace(
    tx: ControlPlaneTransaction,
    _manifest: ControlPlaneTransferManifest,
  ): Promise<void> {
    const deleted = new Set<AnyPgTable>();
    for (const definition of [...PORTABLE_ENTITY_CATALOG].reverse()) {
      if (deleted.has(definition.table)) continue;
      deleted.add(definition.table);
      await tx.delete(definition.table);
    }
  }

  async applyRecord(
    tx: ControlPlaneTransaction,
    record: PortableControlPlaneRecord,
    _mode: "replace" | "merge",
  ): Promise<{ imported: boolean; conflict?: string }> {
    const { definition, physicalId, values } = recordPayload(record);
    const restored = restoreValues(definition, values);
    const table = definition.table as AnyPgTable;
    const [existing] = (await tx
      .select()
      .from(table)
      .where(eq(definition.idColumn, physicalId))
      .limit(1)) as Array<Record<string, unknown>>;
    if (existing) {
      const existingProjection = Object.fromEntries(
        Object.keys(values).map((key) => [key, existing[key]]),
      );
      const restoredProjection = Object.fromEntries(
        Object.keys(values).map((key) => [key, restored[key]]),
      );
      if (
        comparable(definition, existingProjection) ===
        comparable(definition, restoredProjection)
      ) {
        this.acceptedIdentities.add(`${definition.name}:${physicalId}`);
        return { imported: false };
      }
      return {
        imported: false,
        conflict: `${definition.name}/${physicalId}: destination record differs`,
      };
    }
    await tx.insert(table).values(restored);
    this.acceptedIdentities.add(`${definition.name}:${physicalId}`);
    return { imported: true };
  }

  async applySecrets(
    tx: ControlPlaneTransaction,
    secrets: EncryptedSecrets,
    _mode: "replace" | "merge",
  ): Promise<readonly string[]> {
    const conflicts: string[] = [];
    for (const [key, payload] of Object.entries(secrets)) {
      const binding = parseSecretKey(key);
      if (!binding) {
        conflicts.push(`${key}: unknown portable secret binding`);
        continue;
      }
      if (
        !this.acceptedIdentities.has(
          `${binding.definition.name}:${binding.physicalId}`,
        )
      ) {
        conflicts.push(`${key}: destination record has an unresolved conflict`);
        continue;
      }
      const updated = await tx
        .update(binding.definition.table)
        .set(encryptedColumns(binding.storage, payload))
        .where(eq(binding.definition.idColumn, binding.physicalId))
        .returning({ id: binding.definition.idColumn });
      if (updated.length === 0) {
        conflicts.push(`${key}: destination record was not imported`);
      }
    }
    return conflicts;
  }
}
