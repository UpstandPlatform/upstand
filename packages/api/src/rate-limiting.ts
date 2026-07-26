/** Public rate-limit application service and policy contract. */

export type {
  RateLimitPolicy,
  RateLimitProfile,
} from "./rate-limiting/policy";
export {
  RATE_LIMIT_PROFILES,
  rateLimitPolicy,
  resolveRateLimitPolicy,
} from "./rate-limiting/policy";
export type { EnforceRequestRateLimitOptions } from "./rate-limiting/service";
export {
  enforceRequestRateLimit,
  getRateLimiterHealth,
} from "./rate-limiting/service";
