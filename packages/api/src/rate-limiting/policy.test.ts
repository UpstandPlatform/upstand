import { describe, expect, test } from "bun:test";
import {
  RATE_LIMIT_PROFILES,
  rateLimitPolicy,
  resolveRateLimitPolicy,
} from "./policy";

describe("rate-limit policy", () => {
  test("applies the stricter fallback to sensitive procedures", () => {
    expect(rateLimitPolicy("auth.signIn", false)).toMatchObject({
      limit: 60,
      fallbackLimit: 10,
      windowSeconds: 60,
      failClosedOnRedisFailure: true,
    });
  });

  test("fails closed for distributed protocol boundaries", () => {
    expect(RATE_LIMIT_PROFILES.webhooks.failClosedOnRedisFailure).toBeTrue();
    expect(RATE_LIMIT_PROFILES.scim.failClosedOnRedisFailure).toBeTrue();
    expect(
      rateLimitPolicy("projects.list", true).failClosedOnRedisFailure,
    ).toBeFalse();
  });

  test("uses the shared protocol profiles", () => {
    expect(resolveRateLimitPolicy("webhooks", "webhooks", false)).toEqual(
      RATE_LIMIT_PROFILES.webhooks,
    );
    expect(resolveRateLimitPolicy("scim", "scim", false)).toEqual(
      RATE_LIMIT_PROFILES.scim,
    );
  });
});
