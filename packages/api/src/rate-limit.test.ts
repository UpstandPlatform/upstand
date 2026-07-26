import { describe, expect, test } from "bun:test";
import { RateLimiter, type RateLimitRedis } from "./rate-limit";

function createFakeRedis() {
  const values = new Map<string, number>();
  let shouldFail = false;
  let incrementCalls = 0;
  let expireCalls = 0;
  const redis: RateLimitRedis = {
    async incr(key) {
      incrementCalls += 1;
      if (shouldFail) throw new Error("Redis unavailable");
      const next = (values.get(key) ?? 0) + 1;
      values.set(key, next);
      return next;
    },
    async expire() {
      expireCalls += 1;
      if (shouldFail) throw new Error("Redis unavailable");
      return 1;
    },
  };
  return {
    redis,
    values,
    setFailure(value: boolean) {
      shouldFail = value;
    },
    get incrementCalls() {
      return incrementCalls;
    },
    get expireCalls() {
      return expireCalls;
    },
  };
}

describe("bounded Redis rate-limit fallback", () => {
  test("uses the distributed counter while Redis is healthy", async () => {
    const fake = createFakeRedis();
    const limiter = new RateLimiter(fake.redis, { now: () => 60_000 });

    const first = await limiter.check({
      key: "route:client",
      limit: 2,
      fallbackLimit: 1,
      windowSeconds: 60,
    });
    const second = await limiter.check({
      key: "route:client",
      limit: 2,
      fallbackLimit: 1,
      windowSeconds: 60,
    });
    const third = await limiter.check({
      key: "route:client",
      limit: 2,
      fallbackLimit: 1,
      windowSeconds: 60,
    });

    expect(first).toMatchObject({
      allowed: true,
      source: "redis",
      remaining: 1,
    });
    expect(second).toMatchObject({
      allowed: true,
      source: "redis",
      remaining: 0,
    });
    expect(third).toMatchObject({
      allowed: false,
      source: "redis",
      remaining: 0,
    });
    expect(fake.incrementCalls).toBe(3);
    expect(fake.expireCalls).toBe(1);
  });

  test("switches to a stricter local limiter and opens a circuit", async () => {
    let now = 100_000;
    const fake = createFakeRedis();
    fake.setFailure(true);
    const limiter = new RateLimiter(fake.redis, {
      now: () => now,
      redisCooldownMs: 5_000,
      redisTimeoutMs: 10,
    });

    const first = await limiter.check({
      key: "auth:client",
      limit: 60,
      fallbackLimit: 2,
      windowSeconds: 60,
    });
    const second = await limiter.check({
      key: "auth:client",
      limit: 60,
      fallbackLimit: 2,
      windowSeconds: 60,
    });
    const third = await limiter.check({
      key: "auth:client",
      limit: 60,
      fallbackLimit: 2,
      windowSeconds: 60,
    });

    expect(first).toMatchObject({ allowed: true, source: "local", limit: 2 });
    expect(second).toMatchObject({ allowed: true, source: "local", limit: 2 });
    expect(third).toMatchObject({ allowed: false, source: "local", limit: 2 });
    expect(fake.incrementCalls).toBe(1);
    expect(limiter.getHealth()).toMatchObject({
      status: "fallback",
      redisFailures: 1,
      fallbackRequests: 3,
      localEntryCount: 1,
    });

    now += 5_000;
    fake.setFailure(false);
    const recovered = await limiter.check({
      key: "auth:client",
      limit: 60,
      fallbackLimit: 2,
      windowSeconds: 60,
    });
    expect(recovered.source).toBe("redis");
    expect(limiter.getHealth().status).toBe("distributed");
    expect(fake.incrementCalls).toBe(2);
  });

  test("bounds local state and expires inactive identities", async () => {
    let now = 0;
    const fake = createFakeRedis();
    fake.setFailure(true);
    const limiter = new RateLimiter(fake.redis, {
      now: () => now,
      localEntryLimit: 2,
      redisCooldownMs: 60_000,
      redisTimeoutMs: 10,
    });
    const options = {
      limit: 60,
      fallbackLimit: 10,
      windowSeconds: 60,
    };

    await limiter.check({ ...options, key: "one" });
    await limiter.check({ ...options, key: "two" });
    await limiter.check({ ...options, key: "three" });
    expect(limiter.getHealth().localEntryCount).toBe(2);

    now = 60_001;
    await limiter.check({ ...options, key: "four" });
    expect(limiter.getHealth().localEntryCount).toBe(1);
  });

  test("enforces positive value constraints on configuration and checks", async () => {
    const fake = createFakeRedis();

    // Constructor options constraints
    expect(() => new RateLimiter(fake.redis, { redisTimeoutMs: 0 })).toThrow();
    expect(
      () => new RateLimiter(fake.redis, { redisCooldownMs: -1 }),
    ).toThrow();
    expect(() => new RateLimiter(fake.redis, { localEntryLimit: 0 })).toThrow();

    const limiter = new RateLimiter(fake.redis);
    const options = {
      key: "test",
      limit: 10,
      fallbackLimit: 5,
      windowSeconds: 60,
    };

    // Check options constraints
    expect(limiter.check({ ...options, limit: 0 })).rejects.toThrow();
    expect(limiter.check({ ...options, fallbackLimit: -5 })).rejects.toThrow();
    expect(limiter.check({ ...options, windowSeconds: 0 })).rejects.toThrow();
  });

  test("calculates token bucket refill and capacity capping accurately", async () => {
    let now = 0;
    const fake = createFakeRedis();
    fake.setFailure(true); // Force fallback

    const limiter = new RateLimiter(fake.redis, {
      now: () => now,
      redisCooldownMs: 60_000,
    });

    const options = {
      key: "refill-test",
      limit: 100, // ignored in fallback
      fallbackLimit: 10, // 10 tokens max
      windowSeconds: 10, // refill rate = 1 token/sec (10 tokens / 10,000 ms)
    };

    // 1. Consume all 10 tokens
    for (let i = 0; i < 10; i++) {
      const res = await limiter.check(options);
      expect(res.allowed).toBe(true);
    }
    // 11th is blocked
    const eleventh = await limiter.check(options);
    expect(eleventh.allowed).toBe(false);

    // 2. Advance time by 500ms (refills 0.5 tokens, not enough for 1 token)
    now += 500;
    const checkHalfSecond = await limiter.check(options);
    expect(checkHalfSecond.allowed).toBe(false);

    // 3. Advance time by another 500ms (total 1000ms elapsed since draining -> refills 1 token)
    now += 500;
    const checkOneSecond = await limiter.check(options);
    expect(checkOneSecond.allowed).toBe(true);
    expect(checkOneSecond.remaining).toBe(0); // consumed the refilled token

    const checkImmediateNext = await limiter.check(options);
    expect(checkImmediateNext.allowed).toBe(false); // empty again

    // 4. Advance time by 20 seconds (should refill 20 tokens, but must be capped at capacity = 10)
    now += 20_000;
    for (let i = 0; i < 10; i++) {
      const res = await limiter.check(options);
      expect(res.allowed).toBe(true);
    }
    const capOverLimit = await limiter.check(options);
    expect(capOverLimit.allowed).toBe(false);
  });

  test("updates key position in local Map to implement LRU eviction", async () => {
    const now = 0;
    const fake = createFakeRedis();
    fake.setFailure(true);

    const limiter = new RateLimiter(fake.redis, {
      now: () => now,
      localEntryLimit: 2,
      redisCooldownMs: 60_000,
    });

    const options = {
      limit: 10,
      fallbackLimit: 1, // Only 1 request allowed before rate limit blocks
      windowSeconds: 10,
    };

    // Insert key "A" and "B" (map is [A, B])
    await limiter.check({ ...options, key: "keyA" });
    await limiter.check({ ...options, key: "keyB" });

    // Try key "A" again. This is blocked (since limit is 1), but it MUST move A to the back: [B, A]
    const blockA = await limiter.check({ ...options, key: "keyA" });
    expect(blockA.allowed).toBe(false);

    // Insert key "C" which triggers eviction. The oldest key "B" should be evicted.
    await limiter.check({ ...options, key: "keyC" });

    // "keyA" should NOT have been evicted because we updated it. So its bucket remains rate-limited (0 tokens).
    const checkA = await limiter.check({ ...options, key: "keyA" });
    expect(checkA.allowed).toBe(false); // still rate-limited!

    // Since "keyB" was evicted, its entry is deleted. Querying it again re-initializes it with a fresh bucket (1 token).
    const checkB = await limiter.check({ ...options, key: "keyB" });
    expect(checkB.allowed).toBe(true); // fresh bucket allowed!
  });

  test("triggers fallback on Redis command timeouts and respects cooldown circuit breaker", async () => {
    let now = 0;
    let incrCalled = 0;

    // A Redis implementation that takes 50ms to respond
    const slowRedis: RateLimitRedis = {
      async incr() {
        incrCalled += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 1;
      },
      async expire() {
        return 1;
      },
    };

    const limiter = new RateLimiter(slowRedis, {
      now: () => now,
      redisTimeoutMs: 10, // Timeout set to 10ms (less than 50ms Redis latency)
      redisCooldownMs: 5_000,
    });

    const options = {
      key: "timeout-test",
      limit: 10,
      fallbackLimit: 2,
      windowSeconds: 60,
    };

    // 1. First request triggers Redis check, which times out and falls back to local
    const first = await limiter.check(options);
    expect(first.source).toBe("local");
    expect(first.allowed).toBe(true);
    expect(incrCalled).toBe(1);
    expect(limiter.getHealth().status).toBe("fallback");

    // 2. Second request is within redisCooldownMs (5,000ms). It must bypass Redis entirely and use local immediately.
    now += 1_000;
    const second = await limiter.check(options);
    expect(second.source).toBe("local");
    expect(second.allowed).toBe(true);
    expect(incrCalled).toBe(1); // Call count to Redis did not increase!

    // 3. Third request exceeds local fallbackLimit (2) and is blocked
    const third = await limiter.check(options);
    expect(third.allowed).toBe(false);
    expect(incrCalled).toBe(1);

    // 4. Advance time past the cooldown window. The circuit breaker should close and try Redis again.
    now += 5_000; // total 6,000ms elapsed
    // This request will call slowRedis.incr, which times out again, extending the fallback window.
    const fourth = await limiter.check(options);
    expect(fourth.source).toBe("local");
    expect(incrCalled).toBe(2); // Redis was called a second time!
  });
});
