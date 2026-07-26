import { env } from "@upstand/env/server";
import type { NodePgTransaction } from "drizzle-orm/node-postgres";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import * as schema from "./schema";

export * from "./schema";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

export function createDb() {
  return drizzle(pool, { schema });
}

export const db = createDb();

export async function closeDb() {
  await pool.end();
}

export async function migrateDatabase(migrationsFolder: string): Promise<void> {
  await migrate(db, { migrationsFolder });
}

export type DatabaseExecutor = NodePgDatabase<typeof schema>;
export type DatabaseTransactionClient = NodePgTransaction<
  typeof schema,
  Record<string, never>
>;
