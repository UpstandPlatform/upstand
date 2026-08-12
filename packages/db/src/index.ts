import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
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

export * from "./migration-preflight";
export * from "./pglite-lock";
export * from "./pglite-migrator";
export * from "./schema";

/**
 * The pool is retained for integrations that need a dedicated Postgres
 * connection. Desktop uses PGlite and must never use this pool for data access.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL ?? "",
  max: env.UPSTAND_DATABASE_POOL_MAX,
  idleTimeoutMillis: env.UPSTAND_DATABASE_POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.UPSTAND_DATABASE_POOL_CONNECTION_TIMEOUT_MS,
});

pool.on("error", () => {
  // Prevent idle-client errors during a database outage from becoming
  // unhandled process errors. New requests still fail closed and the pool
  // evicts the broken client.
});

export type Database = NodePgDatabase<typeof schema>;

let activePglite: { close(): Promise<void> } | null = null;

function pgliteDataDirectory(): string {
  const configured = env.PGLITE_DATA_DIR?.trim();
  if (configured) return resolve(configured);
  const home = os.homedir() || process.cwd();
  return resolve(home, ".upstand", "data");
}

export async function createDb(): Promise<Database> {
  if (env.UPSTAND_PLATFORM === "desktop" && !env.IS_CLOUD) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const dataDir = pgliteDataDirectory();
    mkdirSync(dataDir, { recursive: true });
    await acquirePgliteLock(dataDir);
    removeStalePgliteControlFile(dataDir);
    const assetsDir = env.PGLITE_ASSETS_DIR?.trim();
    const options = assetsDir
      ? await (async () => {
          const [wasmBytes, dataBytes] = await Promise.all([
            readFile(resolve(assetsDir, "pglite.wasm")),
            readFile(resolve(assetsDir, "pglite.data")),
          ]);
          return {
            fsBundle: new Blob([new Uint8Array(dataBytes)]),
            wasmModule: await WebAssembly.compile(wasmBytes),
          };
        })()
      : undefined;
    const client = new PGlite(dataDir, options);
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
  if (env.UPSTAND_PLATFORM === "desktop" && !env.IS_CLOUD) return;
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  await migrate(db as NodePgDatabase<typeof schema>, { migrationsFolder });
}

export type DatabaseExecutor = Database;
export type DatabaseTransactionClient = PgTransaction<
  PgQueryResultHKT,
  typeof schema,
  Record<string, never>
>;
