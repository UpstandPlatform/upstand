import { describe, expect, test } from "bun:test";
import { RedisMcpConnectionLimiter } from "./mcp-connection-limiter";

class FakeRedis {
  calls: unknown[][] = [];
  acquireResults: number[] = [1];
  renewResults: number[] = [1];
  error: Error | null = null;

  async eval(...args: unknown[]) {
    this.calls.push(args);
    if (this.error) throw this.error;
    const script = String(args[0]);
    if (script.includes("ZREMRANGEBYSCORE")) {
      return this.acquireResults.shift() ?? 0;
    }
    if (script.includes("ZSCORE")) {
      return this.renewResults.shift() ?? 0;
    }
    return 1;
  }
}

describe("Redis MCP connection limiter", () => {
  test("uses a distributed lease and releases it idempotently", async () => {
    const redis = new FakeRedis();
    const limiter = new RedisMcpConnectionLimiter(redis, {
      maxConnections: 2,
      maxConnectionsPerKey: 1,
      leaseTtlMs: 10_000,
    });

    const lease = await limiter.acquire("key-a");
    expect(lease).not.toBeNull();
    expect(redis.calls[0]?.[1]).toBe(2);
    expect(redis.calls[0]?.[2]).toBe("upstand:mcp:connections:global");
    expect(String(redis.calls[0]?.[3])).toContain(
      "upstand:mcp:connections:key:key-a",
    );
    expect(await lease?.renew()).toBe(true);

    await lease?.release();
    await lease?.release();
    expect(
      redis.calls.filter((call) => String(call[0]).includes("local removed"))
        .length,
    ).toBe(1);
  });

  test("returns capacity exhaustion without creating a lease", async () => {
    const redis = new FakeRedis();
    redis.acquireResults = [0];
    const limiter = new RedisMcpConnectionLimiter(redis);

    expect(await limiter.acquire("key-a")).toBeNull();
    expect(redis.calls).toHaveLength(1);
  });

  test("treats Redis failure as an unavailable capacity check", async () => {
    const redis = new FakeRedis();
    redis.error = new Error("redis unavailable");
    const limiter = new RedisMcpConnectionLimiter(redis);

    await expect(limiter.acquire("key-a")).rejects.toThrow("redis unavailable");
  });

  test("does not release a lease that Redis has already expired", async () => {
    const redis = new FakeRedis();
    redis.renewResults = [0];
    const limiter = new RedisMcpConnectionLimiter(redis);
    const lease = await limiter.acquire("key-a");

    expect(await lease?.renew()).toBe(false);
    await lease?.release();
    expect(
      redis.calls.filter((call) => String(call[0]).includes("local removed"))
        .length,
    ).toBe(0);
  });

  test("rejects invalid lease settings", () => {
    expect(
      () =>
        new RedisMcpConnectionLimiter(new FakeRedis(), {
          leaseTtlMs: 0,
        }),
    ).toThrow("leaseTtlMs must be a positive integer");
  });
});
