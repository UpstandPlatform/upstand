import { describe, expect, test } from "bun:test";
import {
  RATE_LIMIT_PROFILES,
  rateLimitPolicy,
  resolveRateLimitPolicy,
  withoutDistributedLimiter,
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

  test("keeps a single-process control plane serving sensitive routes", () => {
    // Desktop ships no Redis, so a fail-closed policy there would reject every
    // create, update, and delete rather than rate limiting it.
    const expensive = rateLimitPolicy("project.create", true);
    expect(expensive.failClosedOnRedisFailure).toBeTrue();

    const singleProcess = withoutDistributedLimiter(expensive);
    expect(singleProcess.failClosedOnRedisFailure).toBeFalse();
    expect(singleProcess.limit).toBe(expensive.limit);
    expect(singleProcess.windowSeconds).toBe(expensive.windowSeconds);
    // The conservative outage fallback exists for an unknown replica count;
    // one process enforces the real limit instead.
    expect(singleProcess.fallbackLimit).toBe(expensive.limit);
  });

  test("does not relax a policy while a distributed limiter is present", () => {
    for (const path of ["auth.signIn", "project.create", "projects.list"]) {
      const policy = rateLimitPolicy(path, true);
      expect(resolveRateLimitPolicy("default", path, true)).toEqual(policy);
    }
  });
});
