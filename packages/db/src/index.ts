import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "@upstand/env/server";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import {
  acquirePgliteLock,
  releasePgliteLock,
  removeStalePgliteControlFile,
} from "./pglite-lock";
import { migratePglite } from "./pglite-migrator";
import * as schema from "./schema";

export * from "./pglite-lock";
export * from "./pglite-migrator";
export * from "./schema";

/**
 * The pool is retained for integrations that need a dedicated Postgres
 * connection. Desktop uses PGlite and must never use this pool for data access.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL ?? "",
});

export type Database = NodePgDatabase<typeof schema>;

let activePglite: { close(): Promise<void> } | null = null;

function pgliteDataDirectory(): string {
  const configured = env.PGLITE_DATA_DIR?.trim();
  if (configured) return resolve(configured);
  const home = process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();
  return resolve(home, ".upstand", "data");
}

export async function createDb(): Promise<Database> {
  if (env.UPSTAND_PLATFORM === "desktop") {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const dataDir = pgliteDataDirectory();
    mkdirSync(dataDir, { recursive: true });
    await acquirePgliteLock(dataDir);
    removeStalePgliteControlFile(dataDir);
    const client = new PGlite(dataDir);
    activePglite = client;
    const database = drizzle(client, { schema }) as unknown as Database;
    await migratePglite(database, {
      migrationsFolder:
        env.DB_MIGRATIONS_PATH?.trim() ||
        resolve(fileURLToPath(new URL(".", import.meta.url)), "migrations"),
    });
    return database;
  }

  return drizzle(pool, { schema });
}

export const db = await createDb();

export async function closeDb(): Promise<void> {
  if (activePglite) {
    await activePglite.close();
    activePglite = null;
    releasePgliteLock();
  }
  await pool.end();
}

export async function migrateDatabase(migrationsFolder: string): Promise<void> {
  if (env.UPSTAND_PLATFORM === "desktop") return;
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  await migrate(db as NodePgDatabase<typeof schema>, { migrationsFolder });
}

export type DatabaseExecutor = Database;
export type DatabaseTransactionClient = PgTransaction<
  PgQueryResultHKT,
  typeof schema,
  Record<string, never>
>;
