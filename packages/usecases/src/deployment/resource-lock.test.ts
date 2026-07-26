import { describe, expect, test } from "bun:test";
import type { Redis } from "@upstand/redis";
import { ResourceLock } from "./resource-lock";

class FakeRedis {
  values = new Map<string, string>();
  renewals = 0;

  async set(key: string, value: string): Promise<"OK" | null> {
    if (this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }

  async eval(script: string, _keys: number, key: string, token: string) {
    if (this.values.get(key) !== token) return 0;
    if (script.includes("pexpire")) {
      this.renewals += 1;
      return 1;
    }
    this.values.delete(key);
    return 1;
  }
}

describe("ResourceLock", () => {
  test("serializes acquisition and only releases its own lease", async () => {
    const redis = new FakeRedis();
    const first = await ResourceLock.acquire(
      redis as unknown as Redis,
      "lock",
      {
        ttlMs: 1_000,
        renewIntervalMs: 100,
      },
    );
    expect(first).not.toBeNull();
    expect(
      await ResourceLock.acquire(redis as unknown as Redis, "lock", {
        ttlMs: 1_000,
        renewIntervalMs: 100,
      }),
    ).toBeNull();

    redis.values.set("lock", "new-owner");
    await first?.release();
    expect(redis.values.get("lock")).toBe("new-owner");
  });

  test("renews a long-running lease", async () => {
    const redis = new FakeRedis();
    const lock = await ResourceLock.acquire(redis as unknown as Redis, "lock", {
      ttlMs: 100,
      renewIntervalMs: 10,
    });
    await Bun.sleep(25);
    lock?.assertOwned();
    expect(redis.renewals).toBeGreaterThan(0);
    await lock?.release();
    expect(redis.values.has("lock")).toBe(false);
  });
});
