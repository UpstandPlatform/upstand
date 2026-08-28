import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Database } from "@upstand/db";
import { migratePglite } from "@upstand/db/pglite-migrator";
import * as schema from "@upstand/db/schema/index";
import {
  decryptSecret,
  type EncryptedPayload,
  encryptSecret,
} from "@upstand/platform/crypto/secret-box";
import {
  ExportControlPlaneTransferService,
  ImportControlPlaneTransferService,
} from "@upstand/usecases/control-plane-transfer/control-plane-transfer.service";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { DrizzleResourceRepository } from "../resource/drizzle-resource.repository";
import { DrizzleControlPlaneExportSource } from "./drizzle-control-plane-export.source";
import { DrizzleControlPlaneImportDestination } from "./drizzle-control-plane-import.destination";
import { DrizzlePortableControlPlaneRecordApplier } from "./drizzle-portable-record.applier";

const migrationsFolder = join(import.meta.dir, "../../../db/src/migrations");

async function migratedDatabase() {
  const client = new PGlite();
  const database = drizzle(client, { schema });
  await migratePglite(database, { migrationsFolder });
  return { client, database: database as unknown as Database };
}

describe("full-schema portable PGlite transfer", () => {
  test("keeps resource tenant discovery anchored to the normalized FK chain", async () => {
    const { client, database } = await migratedDatabase();
    try {
      const createdAt = new Date("2026-08-09T10:00:00.000Z");
      await database.insert(schema.organization).values([
        {
          id: "resource-organization-a",
          name: "Resource Organization A",
          slug: "resource-organization-a",
          createdAt,
        },
        {
          id: "resource-organization-b",
          name: "Resource Organization B",
          slug: "resource-organization-b",
          createdAt,
        },
      ]);
      await database.insert(schema.project).values([
        {
          id: "resource-project-a",
          organizationId: "resource-organization-a",
          name: "Resource Project A",
          createdAt,
        },
        {
          id: "resource-project-b",
          organizationId: "resource-organization-b",
          name: "Resource Project B",
          createdAt,
        },
      ]);
      await database.insert(schema.environment).values([
        {
          id: "resource-environment-a",
          projectId: "resource-project-a",
          name: "Resource Environment A",
          slug: "resource-environment-a",
          createdAt,
        },
        {
          id: "resource-environment-b",
          projectId: "resource-project-b",
          name: "Resource Environment B",
          slug: "resource-environment-b",
          createdAt,
        },
      ]);
      await database.insert(schema.resource).values([
        {
          id: "resource-a",
          environmentId: "resource-environment-a",
          name: "Resource A",
          type: "application",
          provider: "raw",
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: "resource-b",
          environmentId: "resource-environment-b",
          name: "Resource B",
          type: "application",
          provider: "raw",
          createdAt,
          updatedAt: createdAt,
        },
      ]);

      const resources = new DrizzleResourceRepository(database);
      await expect(
        resources.findIdsByOrganizationId("resource-organization-a"),
      ).resolves.toEqual(["resource-a"]);
      await expect(
        resources.findIdsByOrganizationId("resource-organization-b"),
      ).resolves.toEqual(["resource-b"]);

      // Resource ownership is inherited from its non-null environment FK. A
      // valid relational move changes the result for both tenant projections;
      // there is no denormalized organization value that can become stale.
      await database
        .update(schema.resource)
        .set({ environmentId: "resource-environment-b" })
        .where(eq(schema.resource.id, "resource-a"));
      await expect(
        resources.findIdsByOrganizationId("resource-organization-a"),
      ).resolves.toEqual([]);
      await expect(
        resources.findIdsByOrganizationId("resource-organization-b"),
      ).resolves.toEqual(expect.arrayContaining(["resource-a", "resource-b"]));
      await expect(
        (async () => {
          await database.insert(schema.resource).values({
            id: "resource-orphan",
            environmentId: "missing-environment",
            name: "Orphan Resource",
            type: "application",
            provider: "raw",
          });
        })(),
      ).rejects.toThrow();
    } finally {
      await client.close();
    }
  }, 60_000);

  test("exports every catalog table and restores tenant foundations", async () => {
    const source = await migratedDatabase();
    const destination = await migratedDatabase();
    try {
      const createdAt = new Date("2026-08-09T10:00:00.000Z");
      await source.database.insert(schema.user).values({
        id: "user-1",
        name: "Owner",
        email: "owner@example.test",
        emailVerified: true,
        createdAt,
        updatedAt: createdAt,
      });
      await source.database.insert(schema.organization).values({
        id: "organization-1",
        name: "Acme",
        slug: "acme",
        createdAt,
      });
      await source.database.insert(schema.member).values({
        id: "member-1",
        organizationId: "organization-1",
        userId: "user-1",
        role: "owner",
        createdAt,
      });
      await source.database.insert(schema.dockerRegistry).values({
        id: "registry-1",
        organizationId: "organization-1",
        name: "Registry",
        username: "owner",
        password: JSON.stringify(encryptSecret("plaintext-registry-secret")),
        registryUrl: "registry.example.test",
        createdAt,
        updatedAt: createdAt,
      });
      await destination.database.insert(schema.user).values({
        id: "old-user",
        name: "Old Owner",
        email: "old@example.test",
        createdAt,
        updatedAt: createdAt,
      });
      await destination.database.insert(schema.organization).values({
        id: "old-organization",
        name: "Old",
        slug: "old",
        createdAt,
      });
      await destination.database.insert(schema.member).values({
        id: "old-member",
        organizationId: "old-organization",
        userId: "old-user",
        role: "owner",
        createdAt,
      });
      const exportSource = new DrizzleControlPlaneExportSource(
        source.database,
        { sourceEngine: "pglite", sourceInstanceId: "desktop-source" },
      );
      const content = await new ExportControlPlaneTransferService(
        exportSource,
      ).execute({
        includeSecrets: true,
        passphrase: "correct horse battery staple",
      });
      let streamed = "";
      const tappedContent = {
        async *[Symbol.asyncIterator]() {
          for await (const chunk of content) {
            streamed += new TextDecoder().decode(chunk);
            yield chunk;
          }
        },
      };
      const importDestination = new DrizzleControlPlaneImportDestination(
        destination.database,
        "destination-owner",
        new DrizzlePortableControlPlaneRecordApplier(),
      );

      await expect(
        new ImportControlPlaneTransferService(importDestination).execute({
          content: tappedContent,
          mode: "replace",
          passphrase: "correct horse battery staple",
        }),
      ).resolves.toEqual({ imported: 4, conflicts: [] });
      expect(streamed).not.toContain("plaintext-registry-secret");
      expect(
        await destination.database.select().from(schema.user),
      ).toHaveLength(1);
      expect(
        await destination.database.select().from(schema.organization),
      ).toHaveLength(1);
      expect(
        await destination.database.select().from(schema.member),
      ).toHaveLength(1);
      const [registry] = await destination.database
        .select()
        .from(schema.dockerRegistry);
      expect(registry?.password).not.toContain("plaintext-registry-secret");
      expect(
        decryptSecret(JSON.parse(registry?.password ?? "") as EncryptedPayload),
      ).toBe("plaintext-registry-secret");
    } finally {
      await source.client.close();
      await destination.client.close();
    }
  }, 60_000);
});
