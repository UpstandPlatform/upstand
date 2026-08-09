import { describe, expect, test } from "bun:test";
import {
  assertPortableRecordRedacted,
  ControlPlaneTransferManifestSchema,
} from "./control-plane-transfer";

const digest = `sha256:${"a".repeat(64)}`;

describe("portable control-plane transfer", () => {
  test("accepts dependency-ordered manifests", () => {
    const manifest = ControlPlaneTransferManifestSchema.parse({
      format: "upstand-control-plane-transfer",
      formatVersion: 1,
      schemaVersion: "0088",
      sourceEngine: "pglite",
      sourceInstanceId: "desktop-1",
      sourceOwnership: "local-control-plane",
      createdAt: new Date().toISOString(),
      tables: [
        { name: "organizations", recordCount: 1, checksum: digest },
        { name: "projects", recordCount: 2, checksum: digest },
      ],
      secretBundle: null,
    });
    expect(manifest.tables).toHaveLength(2);
  });

  test("rejects reordered tables and accidental secret fields", () => {
    expect(() =>
      ControlPlaneTransferManifestSchema.parse({
        format: "upstand-control-plane-transfer",
        formatVersion: 1,
        schemaVersion: "0088",
        sourceEngine: "postgresql",
        sourceInstanceId: "server-1",
        sourceOwnership: "local-control-plane",
        createdAt: new Date().toISOString(),
        tables: [
          { name: "projects", recordCount: 1, checksum: digest },
          { name: "organizations", recordCount: 1, checksum: digest },
        ],
        secretBundle: null,
      }),
    ).toThrow("dependency order");
    expect(() =>
      assertPortableRecordRedacted({ profile: { apiToken: "plaintext" } }),
    ).toThrow("Sensitive field");
  });
});
