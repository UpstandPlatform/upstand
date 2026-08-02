import { describe, expect, test } from "bun:test";
import type { Redis } from "@upstand/redis";
import {
  acquireBackupRunLock,
  releaseBackupRunLock,
  renewBackupRunLock,
} from "./backup-run-lock";

class FakeRedis {
  private readonly values = new Map<string, string>();

  async set(
    key: string,
    value: string,
    _mode: string,
    _ttl: number,
    _condition: string,
  ): Promise<"OK" | null> {
    if (this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }

  async eval(
    script: string,
    _keys: number,
    key: string,
    token: string,
  ): Promise<number> {
    if (this.values.get(key) !== token) return 0;
    if (script.includes("pexpire")) return 1;
    this.values.delete(key);
    return 1;
  }
}

class HangingRedis {
  set(): Promise<"OK"> {
    return new Promise(() => undefined);
  }

  eval(): Promise<number> {
    return new Promise(() => undefined);
  }
}

describe("backup run lock", () => {
  test("acquires, renews, and releases an owned lock", async () => {
    const redis = new FakeRedis();
    expect(
      await acquireBackupRunLock(
        "schedule-1",
        "run-1",
        redis as unknown as Redis,
      ),
    ).toBe(true);
    expect(
      await renewBackupRunLock(
        "schedule-1",
        "run-1",
        redis as unknown as Redis,
      ),
    ).toBe(true);
    await releaseBackupRunLock(
      "schedule-1",
      "run-1",
      redis as unknown as Redis,
    );
    expect(
      await acquireBackupRunLock(
        "schedule-1",
        "run-2",
        redis as unknown as Redis,
      ),
    ).toBe(true);
  });

  test("bounds a Redis command that never completes", async () => {
    await expect(
      acquireBackupRunLock(
        "schedule-1",
        "run-1",
        new HangingRedis() as unknown as Redis,
      ),
    ).rejects.toThrow("timed out");
  });
});
