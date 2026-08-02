import { env } from "@upstand/env/server";
import type { Pool } from "pg";

export class MigrationPreconditionError extends Error {
  readonly code = "UPSTAND_MIGRATION_PRECONDITION";

  constructor(message: string) {
    super(message);
    this.name = "MigrationPreconditionError";
  }
}

const duplicateChecks = [
  {
    table: "member",
    columns: ["organization_id", "user_id"],
    description: "organization memberships",
  },
  {
    table: "preview_deployment",
    columns: ["resource_id", "pull_request_id"],
    description: "preview deployments for the same resource and pull request",
  },
] as const;

const foreignKeyChecks = [
  {
    table: "backup_schedule",
    column: "organization_id",
    referenceTable: "organization",
    referenceColumn: "id",
    description: "backup schedules with missing organizations",
  },
  {
    table: "backup_run",
    column: "organization_id",
    referenceTable: "organization",
    referenceColumn: "id",
    description: "backup runs with missing organizations",
  },
] as const;

/**
 * Checks data that would make the additive uniqueness migrations fail. The
 * table-existence probe keeps a fresh database compatible with the preflight.
 */
export async function validateMigrationPreconditions(
  client: Pick<Pool, "query">,
): Promise<void> {
  if (env.UPSTAND_PLATFORM === "desktop") return;

  for (const check of duplicateChecks) {
    const relation = await client.query<{ relation: string | null }>(
      "SELECT to_regclass($1) AS relation",
      [`public.${check.table}`],
    );
    if (!relation.rows[0]?.relation) continue;

    const duplicate = await client.query(
      `SELECT 1 FROM "${check.table}" GROUP BY ${check.columns.map((column) => `"${column}"`).join(", ")} HAVING count(*) > 1 LIMIT 1`,
    );
    if (duplicate.rows.length > 0) {
      throw new MigrationPreconditionError(
        `Cannot apply the production migration: duplicate ${check.description} exist in ${check.table}. Resolve duplicates and rerun migrations.`,
      );
    }
  }

  for (const check of foreignKeyChecks) {
    const relation = await client.query<{ relation: string | null }>(
      "SELECT to_regclass($1) AS relation",
      [`public.${check.table}`],
    );
    const referenceRelation = await client.query<{ relation: string | null }>(
      "SELECT to_regclass($1) AS relation",
      [`public.${check.referenceTable}`],
    );
    if (!relation.rows[0]?.relation || !referenceRelation.rows[0]?.relation) {
      continue;
    }

    const orphan = await client.query(
      `SELECT 1 FROM "${check.table}" AS child LEFT JOIN "${check.referenceTable}" AS parent ON child."${check.column}" = parent."${check.referenceColumn}" WHERE parent."${check.referenceColumn}" IS NULL LIMIT 1`,
    );
    if (orphan.rows.length > 0) {
      throw new MigrationPreconditionError(
        `Cannot apply the production migration: ${check.description} exist in ${check.table}. Repair the orphaned rows and rerun migrations.`,
      );
    }
  }
}
