import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { type Database, organization } from "@upstand/db";
import { drizzle } from "drizzle-orm/pglite";
import { DrizzleControlPlaneExportSource } from "./drizzle-control-plane-export.source";
import { PORTABLE_ENTITY_CATALOG } from "./portable-entity-catalog";

describe("DrizzleControlPlaneExportSource", () => {
  test("spools dependency-ordered portable records from PGlite", async () => {
    const client = new PGlite();
    try {
      await client.exec(`
        CREATE TABLE organization (
          id text PRIMARY KEY,
          name text NOT NULL,
          slug text NOT NULL UNIQUE,
          logo text,
          created_at timestamp NOT NULL,
          metadata text
        );
        INSERT INTO organization (id, name, slug, created_at)
        VALUES ('organization-1', 'Acme', 'acme', now());
      `);
      const database = drizzle(client, {
        schema: { organization },
      }) as unknown as Database;
      const organizationDefinition = PORTABLE_ENTITY_CATALOG.filter(
        (definition) => definition.name === "organization",
      );
      const source = new DrizzleControlPlaneExportSource(
        database,
        {
          sourceEngine: "pglite",
          sourceInstanceId: "desktop-1",
          schemaVersion: "0089",
        },
        organizationDefinition,
      );

      const prepared = await source.prepare({ includeSecrets: false });
      const records = [];
      for await (const record of prepared.records) records.push(record);

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        table: "organizations",
        id: "organization:organization-1",
        data: {
          entity: "organization",
          values: { id: "organization-1", name: "Acme", slug: "acme" },
        },
      });
      expect(
        prepared.manifest.tables.find(
          (table) => table.name === "organizations",
        ),
      ).toMatchObject({ recordCount: 1 });
      expect(prepared.manifest.tables.at(0)?.name).toBe("users");
    } finally {
      await client.close();
    }
  });
});
