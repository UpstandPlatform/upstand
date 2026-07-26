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
  const url = options?.url ?? env.REDIS_URL ?? defaultUrl;
  const loggerName = options?.loggerName ?? "redis";

  const isTls = url.startsWith("rediss://");

  const config: RedisOptions = {
    maxRetriesPerRequest: options?.maxRetriesPerRequest ?? null,
    enableReadyCheck: true,
    retryStrategy(times) {
      // Exponential backoff with a cap of 5000ms
      return Math.min(times * 100, 5000);
    },
    ...options?.redisOptions,
  };

  // Automatically enable TLS for secure connections if not explicitly overridden
  if (isTls && !config.tls) {
    config.tls = {
      rejectUnauthorized: false, // Standard override for self-signed cloud services like Render, AWS, Heroku
    };
  }

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
export async function closeRedis(instance: Redis): Promise<void> {
  try {
    await instance.quit();
  } catch {
    instance.disconnect();
  }
}

/**
 * Ping Redis connection to check health status.
 */
export async function pingRedis(instance: Redis): Promise<boolean> {
  try {
    const result = await instance.ping();
    return result === "PONG";
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error("redis-health", `Redis ping failed: ${errMsg}`);
    return false;
  }
}
