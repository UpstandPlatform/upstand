import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import {
  controlPlaneTransferRecord,
  controlPlaneTransferSession,
  type Database,
  organization,
} from "@upstand/db";
import {
  ExportControlPlaneTransferService,
  ImportControlPlaneTransferService,
} from "@upstand/usecases/control-plane-transfer/control-plane-transfer.service";
import { drizzle } from "drizzle-orm/pglite";
import { DrizzleControlPlaneExportSource } from "./drizzle-control-plane-export.source";
import { DrizzleControlPlaneImportDestination } from "./drizzle-control-plane-import.destination";
import { DrizzlePortableControlPlaneRecordApplier } from "./drizzle-portable-record.applier";
import { PORTABLE_ENTITY_CATALOG } from "./portable-entity-catalog";

const organizationDdl = `
  CREATE TABLE organization (
    id text PRIMARY KEY,
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    logo text,
    created_at timestamp NOT NULL,
    metadata text
  );
`;

const stagingDdl = `
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
`;

describe("portable PGlite control-plane transfer", () => {
  test("restores a streamed export into a disposable destination", async () => {
    const sourceClient = new PGlite();
    const destinationClient = new PGlite();
    try {
      await sourceClient.exec(organizationDdl);
      await destinationClient.exec(`${organizationDdl}${stagingDdl}`);
      await sourceClient.exec(`
        INSERT INTO organization (id, name, slug, created_at)
        VALUES ('organization-1', 'Acme', 'acme', now());
      `);
      const sourceDatabase = drizzle(sourceClient, {
        schema: { organization },
      }) as unknown as Database;
      const destinationDatabase = drizzle(destinationClient, {
        schema: {
          organization,
          controlPlaneTransferSession,
          controlPlaneTransferRecord,
        },
      }) as unknown as Database;
      const source = new DrizzleControlPlaneExportSource(
        sourceDatabase,
        { sourceEngine: "pglite", sourceInstanceId: "desktop-source" },
        PORTABLE_ENTITY_CATALOG.filter(
          (definition) => definition.name === "organization",
        ),
      );
      const content = await new ExportControlPlaneTransferService(
        source,
      ).execute({ includeSecrets: false });
      const destination = new DrizzleControlPlaneImportDestination(
        destinationDatabase,
        "actor-1",
        new DrizzlePortableControlPlaneRecordApplier(),
      );

      await expect(
        new ImportControlPlaneTransferService(destination).execute({
          content,
          mode: "merge",
        }),
      ).resolves.toEqual({ imported: 1, conflicts: [] });
      const [restored] = await destinationDatabase.select().from(organization);
      expect(restored).toMatchObject({
        id: "organization-1",
        name: "Acme",
        slug: "acme",
      });
    } finally {
      await sourceClient.close();
      await destinationClient.close();
    }
  });
});
