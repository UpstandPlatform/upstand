import { describe, expect, test } from "bun:test";
import type {
  ControlPlaneTransferManifest,
  PortableControlPlaneRecord,
} from "@upstand/domain";
import {
  ExportControlPlaneTransferService,
  ImportControlPlaneTransferService,
  portableRecordChecksum,
  portableTableChecksum,
} from "./control-plane-transfer.service";

function fixture() {
  const partial = {
    table: "organizations" as const,
    id: "organization-1",
    data: { id: "organization-1", name: "Acme" },
  };
  const record: PortableControlPlaneRecord = {
    ...partial,
    checksum: portableRecordChecksum(partial),
  };
  const manifest: ControlPlaneTransferManifest = {
    format: "upstand-control-plane-transfer",
    formatVersion: 1,
    schemaVersion: "0088",
    sourceEngine: "pglite",
    sourceInstanceId: "desktop-1",
    sourceOwnership: "local-control-plane",
    createdAt: new Date().toISOString(),
    tables: [
      {
        name: "organizations",
        recordCount: 1,
        checksum: portableTableChecksum([record.checksum]),
      },
    ],
    secretBundle: null,
  };
  return { manifest, record };
}

async function collect(
  content: AsyncIterable<Uint8Array>,
): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of content) chunks.push(chunk);
  return chunks;
}

describe("control-plane transfer services", () => {
  test("streams verified records and re-encrypts secrets at the destination boundary", async () => {
    const { manifest, record } = fixture();
    const exporter = new ExportControlPlaneTransferService({
      prepare: async () => ({
        manifest,
        records: {
          async *[Symbol.asyncIterator]() {
            yield record;
          },
        },
      }),
      exportSecrets: async () => ({ "credential-1": "plaintext" }),
    });
    const chunks = await collect(
      await exporter.execute({
        includeSecrets: true,
        passphrase: "correct horse battery staple",
      }),
    );
    expect(Buffer.concat(chunks).toString()).not.toContain("plaintext");

    const staged: string[] = [];
    let rolledBack = false;
    const importer = new ImportControlPlaneTransferService({
      begin: async () => ({
        stageRecord: async (value) => {
          staged.push(value.id);
        },
        stageSecrets: async (values) => {
          staged.push(values["credential-1"] ?? "");
        },
        commit: async () => ({ imported: staged.length, conflicts: [] }),
        rollback: async () => {
          rolledBack = true;
        },
      }),
    });
    const result = await importer.execute({
      content: {
        async *[Symbol.asyncIterator]() {
          for (const chunk of chunks) yield chunk;
        },
      },
      mode: "merge",
      passphrase: "correct horse battery staple",
    });
    expect(result.imported).toBe(2);
    expect(staged).toEqual(["organization-1", "plaintext"]);
    expect(rolledBack).toBe(false);
  });

  test("rolls back atomic staging on checksum failure", async () => {
    const { manifest, record } = fixture();
    let rolledBack = false;
    const importer = new ImportControlPlaneTransferService({
      begin: async () => ({
        stageRecord: async () => {},
        stageSecrets: async () => {},
        commit: async () => ({ imported: 0, conflicts: [] }),
        rollback: async () => {
          rolledBack = true;
        },
      }),
    });
    const body = [
      JSON.stringify({ kind: "manifest", manifest }),
      JSON.stringify({
        kind: "record",
        record: { ...record, data: { id: "tampered" } },
      }),
    ].join("\n");
    await expect(
      importer.execute({
        content: {
          async *[Symbol.asyncIterator]() {
            yield new TextEncoder().encode(body);
          },
        },
        mode: "replace",
      }),
    ).rejects.toThrow("checksum mismatch");
    expect(rolledBack).toBe(true);
  });

  test("refuses direct import of cloud-owned canonical data", async () => {
    const { manifest } = fixture();
    const body = JSON.stringify({
      kind: "manifest",
      manifest: { ...manifest, sourceOwnership: "cloud-control-plane" },
    });
    const importer = new ImportControlPlaneTransferService({
      begin: async () => {
        throw new Error("must not stage");
      },
    });
    await expect(
      importer.execute({
        content: {
          async *[Symbol.asyncIterator]() {
            yield new TextEncoder().encode(body);
          },
        },
        mode: "merge",
      }),
    ).rejects.toThrow("cloud gateway bring-home");
  });
});
