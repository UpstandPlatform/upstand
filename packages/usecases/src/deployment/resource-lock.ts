import { randomUUID } from "node:crypto";
import type { Redis } from "@upstand/redis";

const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

export interface ResourceLockOptions {
  ttlMs?: number;
  renewIntervalMs?: number;
}

/**
 * A renewable, ownership-safe Redis lease used to serialize deployments for a
 * single resource. Compare-and-renew/release scripts prevent an expired owner
 * from modifying a lock that has since been acquired by another worker.
 */
export class ResourceLock {
  private renewalTimer: ReturnType<typeof setInterval> | null = null;
  private renewalError: Error | null = null;
  private renewalInFlight = false;

  private constructor(
    private readonly redis: Redis,
    readonly key: string,
    private readonly token: string,
    private readonly ttlMs: number,
    renewIntervalMs: number,
  ) {
    this.renewalTimer = setInterval(() => void this.renew(), renewIntervalMs);
    this.renewalTimer.unref?.();
  }

  static async acquire(
    redis: Redis,
    key: string,
    options: ResourceLockOptions = {},
  ): Promise<ResourceLock | null> {
    const ttlMs = options.ttlMs ?? 120_000;
    const renewIntervalMs = options.renewIntervalMs ?? 30_000;
    if (ttlMs <= 0 || renewIntervalMs <= 0 || renewIntervalMs >= ttlMs) {
      throw new Error(
        "Resource lock renewal interval must be less than its TTL",
      );
    }

    const token = randomUUID();
    const acquired = await redis.set(key, token, "PX", ttlMs, "NX");
    return acquired === "OK"
      ? new ResourceLock(redis, key, token, ttlMs, renewIntervalMs)
      : null;
  }

  assertOwned(): void {
    if (this.renewalError) {
      throw new Error(
        `Lost resource deployment lock '${this.key}': ${this.renewalError.message}`,
      );
    }
  }

  async release(): Promise<void> {
    if (this.renewalTimer) {
      clearInterval(this.renewalTimer);
      this.renewalTimer = null;
    }
    await this.redis.eval(RELEASE_SCRIPT, 1, this.key, this.token);
  }

  private async renew(): Promise<void> {
    if (this.renewalInFlight || this.renewalError) return;
    this.renewalInFlight = true;
    try {
      const renewed = await this.redis.eval(
        RENEW_SCRIPT,
        1,
        this.key,
        this.token,
        String(this.ttlMs),
      );
      if (Number(renewed) !== 1) {
        throw new Error("lease is no longer owned by this worker");
      }
    } catch (error) {
      this.renewalError =
        error instanceof Error ? error : new Error(String(error));
      if (this.renewalTimer) {
        clearInterval(this.renewalTimer);
        this.renewalTimer = null;
      }
    } finally {
      this.renewalInFlight = false;
    }
  }
}
