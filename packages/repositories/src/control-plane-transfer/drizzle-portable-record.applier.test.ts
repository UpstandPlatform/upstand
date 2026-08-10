import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { type Database, organization } from "@upstand/db";
import type { PortableControlPlaneRecord } from "@upstand/domain";
import { drizzle } from "drizzle-orm/pglite";
import { DrizzlePortableControlPlaneRecordApplier } from "./drizzle-portable-record.applier";

async function databaseFixture() {
  const client = new PGlite();
  await client.exec(`
    CREATE TABLE organization (
      id text PRIMARY KEY,
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      logo text,
      created_at timestamp NOT NULL,
      metadata text
    );
  `);
  return {
    client,
    database: drizzle(client, {
      schema: { organization },
    }) as unknown as Database,
  };
}

function record(name = "Acme"): PortableControlPlaneRecord {
  return {
    table: "organizations",
    id: "organization:organization-1",
    checksum: `sha256:${"a".repeat(64)}`,
    data: {
      entity: "organization",
      values: {
        id: "organization-1",
        name,
        slug: "acme",
        logo: null,
        createdAt: "2026-08-09T10:00:00.000Z",
        metadata: null,
      },
    },
  };
}

describe("DrizzlePortableControlPlaneRecordApplier", () => {
  test("imports a record and reports deterministic merge conflicts", async () => {
    const { client, database } = await databaseFixture();
    try {
      const applier = new DrizzlePortableControlPlaneRecordApplier();
      const first = await database.transaction((tx) =>
        applier.applyRecord(tx, record(), "merge"),
      );
      const retry = await database.transaction((tx) =>
        applier.applyRecord(tx, record(), "merge"),
      );
      const conflict = await database.transaction((tx) =>
        applier.applyRecord(tx, record("Different"), "merge"),
      );

      expect(first).toEqual({ imported: true });
      expect(retry).toEqual({ imported: false });
      expect(conflict).toMatchObject({
        imported: false,
        conflict: "organization/organization-1: destination record differs",
      });
      const [stored] = await database.select().from(organization);
      expect(stored?.name).toBe("Acme");
      expect(stored?.createdAt).toEqual(new Date("2026-08-09T10:00:00.000Z"));
    } finally {
      await client.close();
    }
  });

  test("rejects records whose portable and physical identities diverge", async () => {
    const { client, database } = await databaseFixture();
    try {
      const applier = new DrizzlePortableControlPlaneRecordApplier();
      const invalid = record();
      invalid.data.values = {
        ...(invalid.data.values as Record<string, unknown>),
        id: "organization-2",
      };
      await expect(
        database.transaction((tx) => applier.applyRecord(tx, invalid, "merge")),
      ).rejects.toThrow("identity does not match");
    } finally {
      await client.close();
    }
  });
});
