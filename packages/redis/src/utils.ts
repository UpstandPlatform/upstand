import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

const COMPARE_AND_DELETE = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const COMPARE_AND_RENEW = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`;

const DEFAULT_LOCK_OPERATION_TIMEOUT_MS = 2_000;

export function withRedisTimeout<T>(
  operation: Promise<T>,
  timeoutMs = 1_000,
): Promise<T> {
  const boundedTimeoutMs = Math.max(1, Math.floor(timeoutMs));
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`Redis operation timed out after ${boundedTimeoutMs}ms`),
          ),
        boundedTimeoutMs,
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Redis lock operation timed out")),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function joinNonEmptyParts(params: {
  parts: Array<string | number | null | undefined>;
  separator?: string;
  trim?: boolean;
}): string {
  const separator = params.separator ?? ":";
  const trim = params.trim ?? true;

  return params.parts
    .filter(
      (part): part is string | number => part !== null && part !== undefined,
    )
    .map((part) => (trim ? String(part).trim() : String(part)))
    .filter((part) => part.length > 0)
    .join(separator);
}

export function redisKey(...parts: Array<string | number | null | undefined>) {
  return joinNonEmptyParts({ parts, separator: ":" });
}

export async function setJson(
  redis: Redis,
  key: string,
  value: unknown,
  options?: { ttlSeconds?: number },
) {
  const payload = JSON.stringify(value);
  if (options?.ttlSeconds && options.ttlSeconds > 0) {
    await redis.set(key, payload, "EX", options.ttlSeconds);
    return;
  }
  await redis.set(key, payload);
}

export async function getJson<T>(redis: Redis, key: string): Promise<T | null> {
  const value = await redis.get(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function delByPattern(redis: Redis, pattern: string) {
  const keys = await redis.keys(pattern);
  if (keys.length === 0) return 0;
  return redis.del(...keys);
}

export async function withRedisLock<T>(params: {
  redis: Redis;
  key: string;
  ttlMs: number;
  operationTimeoutMs?: number;
  work: () => Promise<T>;
}) {
  if (!Number.isInteger(params.ttlMs) || params.ttlMs < 1_000) {
    throw new Error("Redis lock TTL must be at least one second");
  }
  const operationTimeoutMs =
    params.operationTimeoutMs ?? DEFAULT_LOCK_OPERATION_TIMEOUT_MS;
  if (!Number.isFinite(operationTimeoutMs) || operationTimeoutMs <= 0) {
    throw new Error("Redis lock operation timeout must be positive");
  }
  const token = randomUUID();
  const acquired = await withTimeout(
    params.redis.set(params.key, token, "PX", params.ttlMs, "NX"),
    operationTimeoutMs,
  );
  if (acquired !== "OK") return null;

  let rejectRenewalFailure: ((error: Error) => void) | null = null;
  const renewalFailure = new Promise<never>((_, reject) => {
    rejectRenewalFailure = reject;
  });
  const renewalTimer = setInterval(
    () => {
      void withTimeout(
        params.redis.eval(
          COMPARE_AND_RENEW,
          1,
          params.key,
          token,
          String(params.ttlMs),
        ),
        operationTimeoutMs,
      )
        .then((renewed) => {
          if (Number(renewed) !== 1) {
            throw new Error("Redis lock is no longer owned");
          }
        })
        .catch((error: unknown) => {
          rejectRenewalFailure?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        });
    },
    Math.max(1_000, Math.floor(params.ttlMs / 3)),
  );
  renewalTimer.unref?.();

  try {
    return await Promise.race([params.work(), renewalFailure]);
  } finally {
    clearInterval(renewalTimer);
    await withTimeout(
      params.redis.eval(COMPARE_AND_DELETE, 1, params.key, token),
      operationTimeoutMs,
    ).catch(() => undefined);
  }
}
