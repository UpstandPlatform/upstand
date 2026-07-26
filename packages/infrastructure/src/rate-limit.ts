import { log } from "evlog";

const DEFAULT_REDIS_TIMEOUT_MS = 750;
const DEFAULT_REDIS_COOLDOWN_MS = 5_000;
const DEFAULT_LOCAL_ENTRY_LIMIT = 10_000;
const LOG_INTERVAL_MS = 60_000;

export type RateLimitRedis = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
};

export type RateLimitCheckOptions = {
  key: string;
  limit: number;
  fallbackLimit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  source: "redis" | "local";
};

export type RateLimiterHealth = {
  status: "distributed" | "fallback";
  redisFailures: number;
  fallbackRequests: number;
  localEntryCount: number;
  lastRedisFailureAt: number | null;
  fallbackUntil: number | null;
};

type LocalBucket = {
  capacity: number;
  refillPerMillisecond: number;
  tokens: number;
  lastUpdatedAt: number;
};

export type RateLimiterOptions = {
  redisTimeoutMs?: number;
  redisCooldownMs?: number;
  localEntryLimit?: number;
  now?: () => number;
};

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Redis rate-limit command timed out")),
      timeoutMs,
    );
    operation.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export class RateLimiter {
  private readonly localBuckets = new Map<string, LocalBucket>();
  private readonly now: () => number;
  private readonly redisTimeoutMs: number;
  private readonly redisCooldownMs: number;
  private readonly localEntryLimit: number;
  private nextLocalCleanupAt = 0;
  private fallbackUntil = 0;
  private lastFailureLogAt = 0;
  private lastRecoveryLogAt = 0;
  private redisFailures = 0;
  private fallbackRequests = 0;
  private lastRedisFailureAt: number | null = null;

  constructor(
    private readonly redis: RateLimitRedis,
    options: RateLimiterOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.redisTimeoutMs = options.redisTimeoutMs ?? DEFAULT_REDIS_TIMEOUT_MS;
    this.redisCooldownMs = options.redisCooldownMs ?? DEFAULT_REDIS_COOLDOWN_MS;
    this.localEntryLimit = options.localEntryLimit ?? DEFAULT_LOCAL_ENTRY_LIMIT;
    if (this.redisTimeoutMs < 1 || this.redisCooldownMs < 1) {
      throw new Error("Redis rate-limit timing values must be positive");
    }
    if (this.localEntryLimit < 1) {
      throw new Error("Local rate-limit entry limit must be positive");
    }
  }

  async check({
    key,
    limit,
    fallbackLimit,
    windowSeconds,
  }: RateLimitCheckOptions): Promise<RateLimitResult> {
    if (limit < 1 || fallbackLimit < 1 || windowSeconds < 1) {
      throw new Error("Rate-limit values must be positive");
    }

    const now = this.now();
    if (this.fallbackUntil > now) {
      return this.checkLocal(key, fallbackLimit, windowSeconds, now);
    }

    const currentWindow = Math.floor(now / 1000 / windowSeconds);
    const redisKey = `${key}:${currentWindow}`;
    try {
      const count = await withTimeout(
        this.redis.incr(redisKey),
        this.redisTimeoutMs,
      );
      if (count === 1) {
        await withTimeout(
          this.redis.expire(redisKey, windowSeconds),
          this.redisTimeoutMs,
        );
      }
      this.markRedisAvailable(now);
      return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        resetAt: (currentWindow + 1) * windowSeconds * 1000,
        source: "redis",
      };
    } catch (error: unknown) {
      this.markRedisUnavailable(now, error);
      return this.checkLocal(key, fallbackLimit, windowSeconds, now);
    }
  }

  getHealth(): RateLimiterHealth {
    const now = this.now();
    return {
      status: this.fallbackUntil > now ? "fallback" : "distributed",
      redisFailures: this.redisFailures,
      fallbackRequests: this.fallbackRequests,
      localEntryCount: this.localBuckets.size,
      lastRedisFailureAt: this.lastRedisFailureAt,
      fallbackUntil: this.fallbackUntil > now ? this.fallbackUntil : null,
    };
  }

  private checkLocal(
    key: string,
    limit: number,
    windowSeconds: number,
    now: number,
  ): RateLimitResult {
    this.fallbackRequests += 1;
    this.cleanupLocalBuckets(now, windowSeconds * 1000);

    const refillPerMillisecond = limit / (windowSeconds * 1000);
    let bucket = this.localBuckets.get(key);
    if (
      !bucket ||
      bucket.capacity !== limit ||
      bucket.refillPerMillisecond !== refillPerMillisecond
    ) {
      if (!bucket && this.localBuckets.size >= this.localEntryLimit) {
        const oldestKey = this.localBuckets.keys().next().value;
        if (oldestKey !== undefined) this.localBuckets.delete(oldestKey);
      }
      bucket = {
        capacity: limit,
        refillPerMillisecond,
        tokens: limit,
        lastUpdatedAt: now,
      };
      this.localBuckets.set(key, bucket);
    } else {
      const elapsed = Math.max(0, now - bucket.lastUpdatedAt);
      bucket.tokens = Math.min(
        bucket.capacity,
        bucket.tokens + elapsed * bucket.refillPerMillisecond,
      );
      bucket.lastUpdatedAt = now;
      this.localBuckets.delete(key);
      this.localBuckets.set(key, bucket);
    }

    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    const waitForToken = Math.max(0, 1 - bucket.tokens);
    return {
      allowed,
      limit,
      remaining: Math.floor(bucket.tokens),
      resetAt: Math.ceil(now + waitForToken / bucket.refillPerMillisecond),
      source: "local",
    };
  }

  private cleanupLocalBuckets(now: number, ttlMs: number): void {
    if (now < this.nextLocalCleanupAt) return;
    for (const [key, bucket] of this.localBuckets) {
      if (now - bucket.lastUpdatedAt >= ttlMs) {
        this.localBuckets.delete(key);
      }
    }
    this.nextLocalCleanupAt = now + Math.min(ttlMs, 5_000);
  }

  private markRedisUnavailable(now: number, error: unknown): void {
    const wasAvailable = this.fallbackUntil <= now;
    this.fallbackUntil = now + this.redisCooldownMs;
    this.redisFailures += 1;
    this.lastRedisFailureAt = now;
    if (wasAvailable && now - this.lastFailureLogAt >= LOG_INTERVAL_MS) {
      this.lastFailureLogAt = now;
      log.error({
        message: "Redis rate limiter unavailable; using bounded local fallback",
        err: error,
        fallbackCooldownMs: this.redisCooldownMs,
      });
    }
  }

  private markRedisAvailable(now: number): void {
    const wasUnavailable = this.fallbackUntil > now;
    this.fallbackUntil = 0;
    if (wasUnavailable && now - this.lastRecoveryLogAt >= LOG_INTERVAL_MS) {
      this.lastRecoveryLogAt = now;
      log.info({
        message: "Redis rate limiter recovered; using distributed limiter",
      });
    }
  }
}
