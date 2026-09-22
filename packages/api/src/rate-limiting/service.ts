import { TRPCError } from "@trpc/server";
import {
  RateLimiter,
  type RateLimitResult,
} from "@upstand/infrastructure/rate-limit";
import { redis } from "@upstand/redis";
import {
  getConfiguredControlPlaneMode,
  getPlatformCapabilities,
} from "@upstand/usecases";
import {
  type RateLimitPolicy,
  type RateLimitProfile,
  resolveRateLimitPolicy,
  withoutDistributedLimiter,
} from "./policy";

/**
 * Desktop runs one control-plane process and ships no Redis, so its limiter is
 * in-process. Every other mode shares a Redis counter across replicas.
 */
function hasDistributedLimiter(): boolean {
  return getPlatformCapabilities(getConfiguredControlPlaneMode()).redis;
}

const distributed = hasDistributedLimiter();
const rateLimiter = new RateLimiter(redis, { distributed });

export class RateLimiterUnavailableError extends Error {
  constructor() {
    super("Rate limiter temporarily unavailable");
    this.name = "RateLimiterUnavailableError";
  }
}

export function getRateLimiterHealth() {
  return rateLimiter.getHealth();
}

export function assertRateLimitAvailability(
  result: Pick<RateLimitResult, "source">,
  policy: Pick<RateLimitPolicy, "failClosedOnRedisFailure">,
): void {
  if (result.source === "local" && policy.failClosedOnRedisFailure) {
    throw new RateLimiterUnavailableError();
  }
}

export type EnforceRequestRateLimitOptions = {
  path: string;
  identifier: string;
  hasSession: boolean;
  setHeader: (name: string, value: string) => void;
  profile?: RateLimitProfile;
  limit?: number;
  fallbackLimit?: number;
};

export async function enforceRequestRateLimit(
  options: EnforceRequestRateLimitOptions,
) {
  const resolvedPolicy = resolveRateLimitPolicy(
    options.profile ?? "default",
    options.path,
    options.hasSession,
  );
  const policy = distributed
    ? resolvedPolicy
    : withoutDistributedLimiter(resolvedPolicy);
  const result = await rateLimiter.check({
    key: `ratelimit:${options.path}:${options.identifier}`,
    limit: options.limit ?? policy.limit,
    fallbackLimit: options.fallbackLimit ?? policy.fallbackLimit,
    windowSeconds: policy.windowSeconds,
  });

  options.setHeader("X-RateLimit-Limit", result.limit.toString());
  options.setHeader("X-RateLimit-Remaining", result.remaining.toString());
  options.setHeader(
    "X-RateLimit-Reset",
    Math.floor(result.resetAt / 1000).toString(),
  );

  assertRateLimitAvailability(result, policy);

  if (!result.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Rate limit exceeded. Please try again in a minute.",
    });
  }

  return result;
}
