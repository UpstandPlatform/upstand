import { closeDb } from "@upstand/db";
import { env } from "@upstand/env/server";
import { closeRedis, redis } from "@upstand/redis";
import { log } from "evlog";
import { runDatabaseMigrations } from "./startup";

const migrationId = env.UPSTAND_MIGRATION_ID;
const migrationKey = migrationId
  ? `upstand:migrations:ready:${migrationId}`
  : undefined;

try {
  if (migrationKey) await redis.del(migrationKey);
  await runDatabaseMigrations();
  if (migrationKey) await redis.set(migrationKey, "ready");
  log.info({ message: "Standalone database migration completed" });
} finally {
  await closeDb();
  await closeRedis(redis);
}
