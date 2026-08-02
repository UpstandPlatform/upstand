import { getRedisWithTimeout, type Redis } from "@upstand/redis";

export type MigrationBarrierOptions = {
  migrationId?: string;
  skipMigrations: boolean;
  redis: Pick<Redis, "get">;
  timeoutMs?: number;
  pollIntervalMs?: number;
  redisTimeoutMs?: number;
};

export async function waitForMigrationBarrier(
  options: MigrationBarrierOptions,
): Promise<void> {
  if (!options.skipMigrations || !options.migrationId) return;

  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const redisTimeoutMs = options.redisTimeoutMs ?? 1_000;
  const key = `upstand:migrations:ready:${options.migrationId}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      if (
        (await getRedisWithTimeout(options.redis, key, redisTimeoutMs)) ===
        "ready"
      ) {
        return;
      }
    } catch {
      // Redis readiness is checked again on the next attempt.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Timed out waiting for the deployment database migration '${options.migrationId}'`,
  );
}
