import { createReadStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Database } from "@upstand/db";
import {
  CONTROL_PLANE_TRANSFER_SCHEMA_VERSION,
  PORTABLE_TABLE_DEPENDENCY_ORDER,
  type PortableControlPlaneRecord,
  type PortableControlPlaneTable,
} from "@upstand/domain";
import {
  decryptSecret,
  type EncryptedPayload,
} from "@upstand/platform/crypto/secret-box";
import {
  type ControlPlaneExportSourcePort,
  portableRecordChecksum,
  portableTableChecksum,
} from "@upstand/usecases/control-plane-transfer/control-plane-transfer.service";
import { asc, gt } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import {
  PORTABLE_ENTITY_CATALOG,
  type PortableEntityDefinition,
  type PortableSecretStorage,
} from "./portable-entity-catalog";

const PAGE_SIZE = 500;
const SENSITIVE_KEY =
  /(?:password|secret|token|private.?key|credential|cookie|session)/i;

type ExportOptions = {
  includeSecrets: boolean;
};

type PreparedSpool = {
  directory: string;
  path: string;
  records: number;
};

type BunFileSink = ReturnType<ReturnType<typeof Bun.file>["writer"]>;

function encryptedPayload(value: unknown): EncryptedPayload | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const payload = parsed as Partial<EncryptedPayload>;
    return typeof payload.ciphertext === "string" &&
      typeof payload.iv === "string" &&
      typeof payload.authTag === "string" &&
      typeof payload.keyVersion === "number"
      ? (payload as EncryptedPayload)
      : null;
  } catch {
    return null;
  }
}

function readSecret(
  row: Readonly<Record<string, unknown>>,
  storage: PortableSecretStorage,
): string | null {
  if (storage.kind === "json") {
    const raw = row[storage.column];
    if (raw === null || raw === undefined || raw === "") return null;
    if (typeof raw !== "string") {
      throw new Error(`Portable secret column '${storage.column}' is invalid`);
    }
    const payload = encryptedPayload(raw);
    return payload ? decryptSecret(payload) : raw;
  }
  const ciphertext = row[storage.ciphertext];
  const iv = row[storage.iv];
  const authTag = row[storage.authTag];
  const keyVersion = row[storage.keyVersion];
  if (ciphertext === null || ciphertext === undefined || ciphertext === "") {
    return null;
  }
  if (
    typeof ciphertext !== "string" ||
    typeof iv !== "string" ||
    typeof authTag !== "string" ||
    typeof keyVersion !== "number"
  ) {
    throw new Error("Portable split secret payload is incomplete");
  }
  return decryptSecret({ ciphertext, iv, authTag, keyVersion });
}

function portableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(portableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .map(([key, child]) => [key, portableValue(child)]),
  );
}

function portableData(
  definition: PortableEntityDefinition,
  row: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const omitted = new Set(definition.omit);
  return {
    entity: definition.name,
    values: Object.fromEntries(
      Object.entries(row)
        .filter(([key]) => !omitted.has(key) && !SENSITIVE_KEY.test(key))
        .map(([key, value]) => [key, portableValue(value)]),
    ),
  };
}

function portableRecord(
  definition: PortableEntityDefinition,
  row: Readonly<Record<string, unknown>>,
): PortableControlPlaneRecord {
  const physicalId = row[definition.idField];
  if (typeof physicalId !== "string" || !physicalId) {
    throw new Error(`Portable entity '${definition.name}' has no string ID`);
  }
  const partial = {
    table: definition.portableTable,
    id: `${definition.name}:${physicalId}`,
    data: portableData(definition, row),
  };
  return { ...partial, checksum: portableRecordChecksum(partial) };
}

function secretKey(entity: string, id: string, field: string): string {
  return `${entity}/${encodeURIComponent(id)}/${field}`;
}

function appendLine(writer: BunFileSink, value: unknown): void {
  writer.write(`${JSON.stringify(value)}\n`);
}

async function* readSpool(spool: PreparedSpool) {
  try {
    const lines = createInterface({
      input: createReadStream(spool.path, { encoding: "utf8" }),
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    for await (const line of lines) {
      if (line) yield JSON.parse(line) as PortableControlPlaneRecord;
    }
  } finally {
    await rm(spool.directory, { recursive: true, force: true });
  }
}

export class DrizzleControlPlaneExportSource
  implements ControlPlaneExportSourcePort
{
  private secrets: Readonly<Record<string, string>> = {};

  constructor(
    private readonly database: Database,
    private readonly options: {
      sourceEngine: "postgresql" | "pglite";
      sourceInstanceId: string;
      schemaVersion?: string;
    },
    private readonly catalog: readonly PortableEntityDefinition[] = PORTABLE_ENTITY_CATALOG,
  ) {}

  async prepare(input: ExportOptions = { includeSecrets: false }) {
    const directory = join(tmpdir(), `upstand-transfer-${crypto.randomUUID()}`);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    const spool: PreparedSpool = {
      directory,
      path: join(directory, "records.ndjson"),
      records: 0,
    };
    const writer = Bun.file(spool.path).writer();
    const checksums = new Map<PortableControlPlaneTable, string[]>();
    const secrets: Record<string, string> = {};
    try {
      for (const definition of this.catalog) {
        for await (const row of this.rows(definition)) {
          const record = portableRecord(definition, row);
          appendLine(writer, record);
          spool.records += 1;
          const tableChecksums = checksums.get(record.table) ?? [];
          tableChecksums.push(record.checksum);
          checksums.set(record.table, tableChecksums);
          if (!input.includeSecrets) continue;
          const physicalId = row[definition.idField] as string;
          for (const [field, storage] of Object.entries(definition.secrets)) {
            const value = readSecret(row, storage);
            if (value !== null) {
              secrets[secretKey(definition.name, physicalId, field)] = value;
            }
          }
        }
      }
      await writer.end();
    } catch (error) {
      try {
        await writer.end();
      } catch {
        // The original export failure remains authoritative.
      }
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    this.secrets = secrets;
    const tables = PORTABLE_TABLE_DEPENDENCY_ORDER.map((name) => {
      const values = checksums.get(name) ?? [];
      return {
        name,
        recordCount: values.length,
        checksum: portableTableChecksum(values),
      };
    });
    return {
      manifest: {
        format: "upstand-control-plane-transfer" as const,
        formatVersion: 1 as const,
        schemaVersion:
          this.options.schemaVersion ?? CONTROL_PLANE_TRANSFER_SCHEMA_VERSION,
        sourceEngine: this.options.sourceEngine,
        sourceInstanceId: this.options.sourceInstanceId,
        sourceOwnership: "local-control-plane" as const,
        createdAt: new Date().toISOString(),
        tables,
        secretBundle: null,
      },
      records: readSpool(spool),
    };
  }

  async exportSecrets(): Promise<Readonly<Record<string, string>>> {
    return this.secrets;
  }

  private async *rows(
    definition: PortableEntityDefinition,
  ): AsyncIterable<Readonly<Record<string, unknown>>> {
    let cursor: string | null = null;
    while (true) {
      const rows = (await this.database
        .select()
        .from(definition.table as AnyPgTable)
        .where(cursor ? gt(definition.idColumn, cursor) : undefined)
        .orderBy(asc(definition.idColumn))
        .limit(PAGE_SIZE)) as Array<Record<string, unknown>>;
      for (const row of rows) {
        yield row as Readonly<Record<string, unknown>>;
      }
      if (rows.length < PAGE_SIZE) return;
      const next: unknown = rows.at(-1)?.[definition.idField];
      if (typeof next !== "string" || !next || next === cursor) {
        throw new Error(`Portable entity '${definition.name}' did not advance`);
      }
      cursor = next;
    }
  }
}
