import { expect, test } from "bun:test";
import {
  assertRateLimitAvailability,
  RateLimiterUnavailableError,
} from "./service";

test("fails closed when a critical policy receives a local fallback result", () => {
  expect(() =>
    assertRateLimitAvailability(
      { source: "local" },
      { failClosedOnRedisFailure: true },
    ),
  ).toThrow(RateLimiterUnavailableError);
});

test("allows bounded local fallback for non-critical traffic", () => {
  expect(() =>
    assertRateLimitAvailability(
      { source: "local" },
      { failClosedOnRedisFailure: false },
    ),
  ).not.toThrow();
});
