import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  controlPlaneTransferRecord,
  controlPlaneTransferSession,
  type Database,
} from "@upstand/db";
import type {
  ControlPlaneTransferManifest,
  PortableControlPlaneRecord,
} from "@upstand/domain";
import { drizzle } from "drizzle-orm/pglite";
import { DrizzleControlPlaneImportDestination } from "./drizzle-control-plane-import.destination";

async function createDatabase() {
  const client = new PGlite();
  await client.exec(`
    CREATE TABLE control_plane_transfer_session (
      id text PRIMARY KEY,
      actor_id text NOT NULL,
      mode text NOT NULL,
      status text NOT NULL DEFAULT 'staging',
      manifest jsonb NOT NULL,
      staged_secrets jsonb,
      cursor integer NOT NULL DEFAULT 0,
      imported_count integer NOT NULL DEFAULT 0,
      conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
      last_error text,
      expires_at timestamp NOT NULL,
      completed_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE control_plane_transfer_record (
      session_id text NOT NULL REFERENCES control_plane_transfer_session(id) ON DELETE CASCADE,
      sequence integer NOT NULL,
      table_name text NOT NULL,
      record_id text NOT NULL,
      checksum text NOT NULL,
      data jsonb NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (session_id, sequence),
      UNIQUE (session_id, table_name, record_id)
    );
  `);
  return {
    client,
    database: drizzle(client, {
      schema: { controlPlaneTransferSession, controlPlaneTransferRecord },
    }) as unknown as Database,
  };
}

function fixture() {
  const partial = {
    table: "organizations" as const,
    id: "organization-1",
    data: { id: "organization-1", name: "Acme" },
  };
  const record: PortableControlPlaneRecord = {
    ...partial,
    checksum: `sha256:${createHash("sha256")
      .update(
        '{"data":{"id":"organization-1","name":"Acme"},"id":"organization-1","table":"organizations"}',
      )
      .digest("hex")}`,
  };
  const manifest: ControlPlaneTransferManifest = {
    format: "upstand-control-plane-transfer",
    formatVersion: 1,
    schemaVersion: "0089",
    sourceEngine: "pglite",
    sourceInstanceId: "desktop-1",
    sourceOwnership: "local-control-plane",
    createdAt: new Date().toISOString(),
    tables: [
      {
        name: "organizations",
        recordCount: 1,
        checksum: `sha256:${createHash("sha256")
          .update(`${record.checksum}\n`)
          .digest("hex")}`,
      },
    ],
    secretBundle: null,
  };
  return { manifest, record };
}

describe("DrizzleControlPlaneImportDestination", () => {
  test("rejects a transfer created by a newer database schema", async () => {
    const { client, database } = await createDatabase();
    try {
      const destination = new DrizzleControlPlaneImportDestination(
        database,
        "actor-1",
        {
          prepareReplace: async () => {},
          applyRecord: async () => ({ imported: true }),
          applySecrets: async () => [],
        },
      );
      const { manifest } = fixture();
      await expect(
        destination.begin({ ...manifest, schemaVersion: "9999" }, "merge"),
      ).rejects.toThrow("not compatible");
    } finally {
      await client.close();
    }
  });

  test("stages retries idempotently and atomically commits records", async () => {
    const { client, database } = await createDatabase();
    try {
      const applied: string[] = [];
      const destination = new DrizzleControlPlaneImportDestination(
        database,
        "actor-1",
        {
          prepareReplace: async () => {},
          applyRecord: async (_tx, record) => {
            applied.push(record.id);
            return { imported: true };
          },
          applySecrets: async () => [],
        },
      );
      const { manifest, record } = fixture();
      const session = await destination.begin(manifest, "merge");
      await session.stageRecord(record);
      await session.stageRecord(record);

      await expect(session.commit()).resolves.toEqual({
        imported: 1,
        conflicts: [],
      });
      expect(applied).toEqual(["organization-1"]);
      const sessions = await database
        .select()
        .from(controlPlaneTransferSession);
      const records = await database.select().from(controlPlaneTransferRecord);
      expect(sessions[0]?.status).toBe("completed");
      expect(records).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  test("retains a failed session for diagnostics after rolling back writes", async () => {
    const { client, database } = await createDatabase();
    try {
      const destination = new DrizzleControlPlaneImportDestination(
        database,
        "actor-1",
        {
          prepareReplace: async () => {},
          applyRecord: async () => {
            throw new Error("destination rejected record");
          },
          applySecrets: async () => [],
        },
      );
      const { manifest, record } = fixture();
      const session = await destination.begin(manifest, "merge");
      await session.stageRecord(record);
      await expect(session.commit()).rejects.toThrow(
        "destination rejected record",
      );
      await session.rollback();

      const sessions = await database
        .select()
        .from(controlPlaneTransferSession);
      expect(sessions[0]?.status).toBe("failed");
      expect(sessions[0]?.lastError).toContain("destination rejected record");
    } finally {
      await client.close();
    }
  });
});
