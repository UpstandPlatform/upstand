const DISTRIBUTED_LIMIT = 60;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export type RateLimitProfile = "default" | "webhooks" | "scim";

export type RateLimitPolicy = {
  limit: number;
  fallbackLimit: number;
  windowSeconds: number;
  /** Critical traffic must not bypass a distributed limiter during Redis outage. */
  failClosedOnRedisFailure: boolean;
};

export const RATE_LIMIT_PROFILES: Record<
  Exclude<RateLimitProfile, "default">,
  RateLimitPolicy
> = {
  webhooks: {
    limit: 120,
    fallbackLimit: 30,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
    failClosedOnRedisFailure: true,
  },
  scim: {
    limit: DISTRIBUTED_LIMIT,
    fallbackLimit: 30,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
    failClosedOnRedisFailure: true,
  },
};

export function rateLimitPolicy(
  path: string,
  hasSession: boolean,
): RateLimitPolicy {
  const normalizedPath = path.toLowerCase();
  const isSensitive =
    /(?:^|\.)(?:auth|scim)\./.test(normalizedPath) ||
    /(?:login|signin|signup|verify|password|token|invite|setup)/.test(
      normalizedPath,
    );
  if (isSensitive) {
    return {
      limit: DISTRIBUTED_LIMIT,
      fallbackLimit: 10,
      windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
      failClosedOnRedisFailure: true,
    };
  }

  const isExpensive =
    /(?:create|update|delete|remove|deploy|control|rebuild|command|generate|restore|run|reload|prune|rotate|scan)/.test(
      normalizedPath,
    );
  if (isExpensive) {
    return {
      limit: DISTRIBUTED_LIMIT,
      fallbackLimit: 15,
      windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
      failClosedOnRedisFailure: true,
    };
  }

  return {
    limit: DISTRIBUTED_LIMIT,
    fallbackLimit: hasSession ? 30 : 20,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
    failClosedOnRedisFailure: false,
  };
}

export function resolveRateLimitPolicy(
  profile: RateLimitProfile,
  path: string,
  hasSession: boolean,
): RateLimitPolicy {
  return profile === "default"
    ? rateLimitPolicy(path, hasSession)
    : RATE_LIMIT_PROFILES[profile];
}
