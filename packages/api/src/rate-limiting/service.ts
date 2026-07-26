import { TRPCError } from "@trpc/server";
import { RateLimiter } from "@upstand/infrastructure/rate-limit";
import { redis } from "@upstand/redis";
import { type RateLimitProfile, resolveRateLimitPolicy } from "./policy";

const rateLimiter = new RateLimiter(redis);

export function getRateLimiterHealth() {
  return rateLimiter.getHealth();
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
  const policy = resolveRateLimitPolicy(
    options.profile ?? "default",
    options.path,
    options.hasSession,
  );
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

  if (!result.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Rate limit exceeded. Please try again in a minute.",
    });
  }

  return result;
}
