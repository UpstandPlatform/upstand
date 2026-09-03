import fs from "node:fs";
import { env } from "@upstand/env/server";
import { log } from "evlog";
import Redis, { type RedisOptions } from "ioredis";

export type { Redis, RedisOptions } from "ioredis";
export {
  delByPattern,
  getJson,
  redisKey,
  setJson,
  withRedisLock,
  withRedisTimeout,
} from "./utils";

function attachRedisErrorHandler(instance: Redis, loggerName = "redis") {
  instance.on("error", (error) => {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : JSON.stringify(error);
    log.error(loggerName, `Redis connection error: ${message}`);
  });
  instance.on("connect", () => {
    log.info(loggerName, "Redis client connecting...");
  });
  instance.on("ready", () => {
    log.info(loggerName, "Redis client ready and connected.");
  });
  instance.on("reconnecting", (delay: number) => {
    log.warn(loggerName, `Redis client reconnecting in ${delay}ms...`);
  });
  instance.on("end", () => {
    log.info(loggerName, "Redis client connection closed.");
  });
}

export type CreateRedisOptions = {
  url?: string;
  maxRetriesPerRequest?: number | null;
  loggerName?: string;
  redisOptions?: Partial<RedisOptions>;
};

export function buildRedisOptions(
  url: string,
  options?: Pick<CreateRedisOptions, "maxRetriesPerRequest" | "redisOptions">,
): RedisOptions {
  const isTls = url.startsWith("rediss://");

  const config: RedisOptions = {
    // Request/response callers must fail promptly when Redis is unavailable.
    // BullMQ workers opt into the required unlimited retry behavior explicitly.
    maxRetriesPerRequest:
      options && "maxRetriesPerRequest" in options
        ? options.maxRetriesPerRequest
        : 1,
    enableReadyCheck: true,
    retryStrategy(times) {
      // Exponential backoff with a cap of 2000ms so short outages recover
      // promptly without creating a tight reconnect loop.
      return Math.min(times * 100, 2000);
    },
    ...options?.redisOptions,
  };

  // Automatically enable TLS for secure connections if not explicitly overridden.
  // Certificate validation stays enabled so a rediss:// URL cannot silently
  // downgrade trust in the external Redis service.
  if (isTls && !config.tls) {
    config.tls = {
      rejectUnauthorized: true,
    };
  }

  return config;
}

/**
 * Create a new Redis connection instance.
 * Each caller gets its own connection — use for workers, subscribers, etc.
 */
export function createRedis(options?: CreateRedisOptions) {
  let defaultUrl = "redis://localhost:6379";
  if (env.REDIS_HOST) {
    let password = env.REDIS_PASSWORD;
    if (!password && fs.existsSync("/run/secrets/redis_password")) {
      try {
        password = fs
          .readFileSync("/run/secrets/redis_password", "utf-8")
          .trim();
      } catch {
        // ignore read error
      }
    }
    const auth = password ? `:${encodeURIComponent(password)}@` : "";
    const port = env.REDIS_PORT ?? 6379;
    defaultUrl = `redis://${auth}${env.REDIS_HOST}:${port}`;
  }
  let fileUrl: string | undefined;
  const urlFile = env.REDIS_URL_FILE;
  if (urlFile && fs.existsSync(urlFile)) {
    try {
      const value = fs.readFileSync(urlFile, "utf8").trim();
      if (value) fileUrl = value;
    } catch {
      // The caller will fail closed when Redis is required. Do not log the
      // file path or its contents because it may identify a secret mount.
    }
  }
  const url = options?.url ?? env.REDIS_URL ?? fileUrl ?? defaultUrl;
  const loggerName = options?.loggerName ?? "redis";

  const config = buildRedisOptions(url, options);

  const instance = new Redis(url, config);
  attachRedisErrorHandler(instance, loggerName);
  return instance;
}

/**
 * Shared singleton connection for general-purpose use (caching, pub/sub publishing).
 * Do NOT use this for BullMQ workers — they need dedicated connections.
 */
export const redis = createRedis();

/**
 * Gracefully close a Redis connection.
 */
export async function closeRedis(
  instance: Redis,
  timeoutMs = 2_000,
): Promise<void> {
  let completed = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const quit = instance
    .quit()
    .catch(() => undefined)
    .finally(() => {
      completed = true;
    });
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, timeoutMs);
    timeout.unref?.();
  });

  try {
    await Promise.race([quit, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (!completed) instance.disconnect();
  }
}

/**
 * Ping Redis connection to check health status.
 */
export async function pingRedis(
  instance: Redis,
  timeoutMs = 1_000,
): Promise<boolean> {
  if (
    "status" in instance &&
    typeof instance.status === "string" &&
    instance.status !== "ready"
  ) {
    return false;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      instance.ping(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Redis ping timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        timeout.unref?.();
      }),
    ]);
    return result === "PONG";
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error("redis-health", `Redis ping failed: ${errMsg}`);
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Read one Redis key without allowing a stalled connection to block a caller
 * past its startup or health-check deadline.
 */
export async function getRedisWithTimeout(
  instance: Pick<Redis, "get">,
  key: string,
  timeoutMs = 1_000,
): Promise<string | null> {
  const boundedTimeoutMs = Math.max(1, Math.floor(timeoutMs));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      instance.get(key),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(`Redis GET timed out after ${boundedTimeoutMs}ms`),
            ),
          boundedTimeoutMs,
        );
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
