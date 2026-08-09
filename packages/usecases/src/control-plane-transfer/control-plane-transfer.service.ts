import { createHash } from "node:crypto";
import {
  assertPortableRecordRedacted,
  type ControlPlaneTransferManifest,
  ControlPlaneTransferManifestSchema,
  type PortableControlPlaneRecord,
  PortableControlPlaneRecordSchema,
  type PortableControlPlaneTable,
} from "@upstand/domain";
import {
  decryptPortableSecretBundle,
  encryptPortableSecretBundle,
  type PortableSecretBundle,
} from "@upstand/platform/crypto/portable-secret-bundle";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_TRANSFER_LINE_BYTES = 16 * 1024 * 1024;

type ManifestEnvelope = {
  kind: "manifest";
  manifest: ControlPlaneTransferManifest;
};
type RecordEnvelope = { kind: "record"; record: PortableControlPlaneRecord };
type SecretEnvelope = { kind: "secret-bundle"; bundle: PortableSecretBundle };
type TransferEnvelope = ManifestEnvelope | RecordEnvelope | SecretEnvelope;

export type ControlPlaneImportMode = "replace" | "merge";

export interface ControlPlaneExportSourcePort {
  prepare(input?: { includeSecrets: boolean }): Promise<{
    manifest: ControlPlaneTransferManifest;
    records: AsyncIterable<PortableControlPlaneRecord>;
  }>;
  exportSecrets?(): Promise<Readonly<Record<string, string>>>;
}

export interface ControlPlaneImportSessionPort {
  stageRecord(record: PortableControlPlaneRecord): Promise<void>;
  stageSecrets(secrets: Readonly<Record<string, string>>): Promise<void>;
  commit(): Promise<{ imported: number; conflicts: readonly string[] }>;
  rollback(): Promise<void>;
}

export interface ControlPlaneImportDestinationPort {
  begin(
    manifest: ControlPlaneTransferManifest,
    mode: ControlPlaneImportMode,
  ): Promise<ControlPlaneImportSessionPort>;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function portableRecordChecksum(input: {
  table: PortableControlPlaneTable;
  id: string;
  data: Readonly<Record<string, unknown>>;
}): string {
  return `sha256:${createHash("sha256")
    .update(
      canonicalJson({ table: input.table, id: input.id, data: input.data }),
    )
    .digest("hex")}`;
}

export function portableTableChecksum(
  recordChecksums: readonly string[],
): string {
  const hash = createHash("sha256");
  for (const checksum of recordChecksums) hash.update(`${checksum}\n`);
  return `sha256:${hash.digest("hex")}`;
}

function line(envelope: TransferEnvelope): Uint8Array {
  return encoder.encode(`${JSON.stringify(envelope)}\n`);
}

function validateRecord(record: PortableControlPlaneRecord): void {
  assertPortableRecordRedacted(record.data);
  const expected = portableRecordChecksum(record);
  if (record.checksum !== expected) {
    throw new Error(
      `Portable record checksum mismatch for '${record.table}/${record.id}'`,
    );
  }
}

function createTableState(manifest: ControlPlaneTransferManifest) {
  return new Map(
    manifest.tables.map((table) => [
      table.name,
      { count: 0, hash: createHash("sha256"), expected: table },
    ]),
  );
}

function trackRecord(
  state: ReturnType<typeof createTableState>,
  record: PortableControlPlaneRecord,
): void {
  const table = state.get(record.table);
  if (!table) throw new Error(`Undeclared portable table '${record.table}'`);
  table.count += 1;
  table.hash.update(`${record.checksum}\n`);
}

function verifyTables(state: ReturnType<typeof createTableState>): void {
  for (const [name, table] of state) {
    const checksum = `sha256:${table.hash.digest("hex")}`;
    if (
      table.count !== table.expected.recordCount ||
      checksum !== table.expected.checksum
    ) {
      throw new Error(`Portable table verification failed for '${name}'`);
    }
  }
}

export class ExportControlPlaneTransferService {
  constructor(private readonly source: ControlPlaneExportSourcePort) {}

  async execute(input: {
    includeSecrets: boolean;
    passphrase?: string;
  }): Promise<AsyncIterable<Uint8Array>> {
    const prepared = await this.source.prepare({
      includeSecrets: input.includeSecrets,
    });
    let secretBundle: PortableSecretBundle | null = null;
    if (input.includeSecrets) {
      if (!input.passphrase) {
        throw new Error("A passphrase is required when exporting secrets");
      }
      if (!this.source.exportSecrets) {
        throw new Error("Secret export is not available for this installation");
      }
      secretBundle = await encryptPortableSecretBundle(
        await this.source.exportSecrets(),
        input.passphrase,
      );
    }
    const manifest = ControlPlaneTransferManifestSchema.parse({
      ...prepared.manifest,
      secretBundle: secretBundle?.descriptor ?? null,
    });
    const records = prepared.records;

    return {
      async *[Symbol.asyncIterator]() {
        yield line({ kind: "manifest", manifest });
        const tableState = createTableState(manifest);
        for await (const rawRecord of records) {
          const record = PortableControlPlaneRecordSchema.parse(rawRecord);
          validateRecord(record);
          trackRecord(tableState, record);
          yield line({ kind: "record", record });
        }
        verifyTables(tableState);
        if (secretBundle)
          yield line({ kind: "secret-bundle", bundle: secretBundle });
      },
    };
  }
}

export class ImportControlPlaneTransferService {
  constructor(
    private readonly destination: ControlPlaneImportDestinationPort,
  ) {}

  async execute(input: {
    content: AsyncIterable<Uint8Array>;
    mode: ControlPlaneImportMode;
    passphrase?: string;
  }): Promise<{ imported: number; conflicts: readonly string[] }> {
    let manifest: ControlPlaneTransferManifest | null = null;
    let session: ControlPlaneImportSessionPort | null = null;
    let tableState: ReturnType<typeof createTableState> | null = null;
    let secretReceived = false;
    try {
      for await (const envelope of decodeEnvelopes(input.content)) {
        if (!manifest) {
          if (envelope.kind !== "manifest") {
            throw new Error("Transfer stream must begin with a manifest");
          }
          manifest = ControlPlaneTransferManifestSchema.parse(
            envelope.manifest,
          );
          if (manifest.sourceOwnership === "cloud-control-plane") {
            throw new Error(
              "Cloud-owned data must use the cloud gateway bring-home operation",
            );
          }
          tableState = createTableState(manifest);
          session = await this.destination.begin(manifest, input.mode);
          continue;
        }
        if (envelope.kind === "manifest") {
          throw new Error("Transfer stream contains multiple manifests");
        }
        if (envelope.kind === "record") {
          if (secretReceived) {
            throw new Error(
              "Records cannot follow the encrypted secret bundle",
            );
          }
          const record = PortableControlPlaneRecordSchema.parse(
            envelope.record,
          );
          validateRecord(record);
          trackRecord(tableState as NonNullable<typeof tableState>, record);
          await session?.stageRecord(record);
          continue;
        }
        if (!manifest.secretBundle) {
          throw new Error("Unexpected secret bundle");
        }
        if (!input.passphrase) {
          throw new Error("A passphrase is required to import secrets");
        }
        if (
          canonicalJson(envelope.bundle.descriptor) !==
          canonicalJson(manifest.secretBundle)
        ) {
          throw new Error(
            "Secret bundle descriptor does not match the manifest",
          );
        }
        await session?.stageSecrets(
          await decryptPortableSecretBundle(envelope.bundle, input.passphrase),
        );
        secretReceived = true;
      }
      if (!manifest || !session || !tableState) {
        throw new Error("Transfer stream is empty");
      }
      verifyTables(tableState);
      if (manifest.secretBundle && !secretReceived) {
        throw new Error(
          "Transfer stream is missing its encrypted secret bundle",
        );
      }
      return await session.commit();
    } catch (error) {
      await session?.rollback().catch(() => undefined);
      throw error;
    }
  }
}

async function* decodeEnvelopes(
  content: AsyncIterable<Uint8Array>,
): AsyncIterable<TransferEnvelope> {
  let pending = "";
  for await (const chunk of content) {
    pending += decoder.decode(chunk, { stream: true });
    if (
      Buffer.byteLength(pending) > MAX_TRANSFER_LINE_BYTES &&
      !pending.includes("\n")
    ) {
      throw new Error("Control-plane transfer line exceeds the safe limit");
    }
    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      const raw = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (raw.trim()) yield parseEnvelope(raw);
      newline = pending.indexOf("\n");
    }
  }
  pending += decoder.decode();
  if (pending.trim()) yield parseEnvelope(pending);
}

function parseEnvelope(raw: string): TransferEnvelope {
  if (Buffer.byteLength(raw) > MAX_TRANSFER_LINE_BYTES) {
    throw new Error("Control-plane transfer line exceeds the safe limit");
  }
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !("kind" in parsed)) {
    throw new Error("Control-plane transfer envelope is invalid");
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.kind === "manifest" && "manifest" in envelope) {
    return envelope as ManifestEnvelope;
  }
  if (envelope.kind === "record" && "record" in envelope) {
    return envelope as RecordEnvelope;
  }
  if (envelope.kind === "secret-bundle" && "bundle" in envelope) {
    return envelope as SecretEnvelope;
  }
  throw new Error("Control-plane transfer envelope kind is invalid");
}
