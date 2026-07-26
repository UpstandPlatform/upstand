/** Compatibility barrel; the rate limiter implementation belongs to infrastructure. */

export type {
  RateLimitCheckOptions,
  RateLimiterHealth,
  RateLimiterOptions,
  RateLimitRedis,
  RateLimitResult,
} from "@upstand/infrastructure/rate-limit";
export { RateLimiter } from "@upstand/infrastructure/rate-limit";
