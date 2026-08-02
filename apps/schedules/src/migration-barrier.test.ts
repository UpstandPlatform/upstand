import { describe, expect, test } from "bun:test";
import { waitForMigrationBarrier } from "./migration-barrier";

describe("schedules migration barrier", () => {
  test("waits until the migration service publishes readiness", async () => {
    const keys: string[] = [];
    let attempts = 0;
    await waitForMigrationBarrier({
      migrationId: "release-1",
      skipMigrations: true,
      pollIntervalMs: 1,
      redis: {
        get: async (key) => {
          keys.push(String(key));
          attempts += 1;
          return attempts === 2 ? "ready" : null;
        },
      },
    });

    expect(keys).toEqual([
      "upstand:migrations:ready:release-1",
      "upstand:migrations:ready:release-1",
    ]);
  });

  test("fails when the migration barrier never becomes ready", async () => {
    await expect(
      waitForMigrationBarrier({
        migrationId: "release-2",
        skipMigrations: true,
        timeoutMs: 5,
        pollIntervalMs: 1,
        redis: { get: async () => null },
      }),
    ).rejects.toThrow("release-2");
  });

  test("does not let a stalled Redis read defeat the overall timeout", async () => {
    await expect(
      waitForMigrationBarrier({
        migrationId: "release-stalled",
        skipMigrations: true,
        timeoutMs: 20,
        pollIntervalMs: 1,
        redisTimeoutMs: 5,
        redis: { get: async () => new Promise<string>(() => undefined) },
      }),
    ).rejects.toThrow("release-stalled");
  });

  test("does not wait when the service owns migrations", async () => {
    let called = false;
    await waitForMigrationBarrier({
      migrationId: "release-3",
      skipMigrations: false,
      redis: {
        get: async () => {
          called = true;
          return "ready";
        },
      },
    });
    expect(called).toBe(false);
  });
});
