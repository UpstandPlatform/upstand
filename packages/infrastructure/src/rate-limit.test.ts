import { expect, test } from "bun:test";
import { RateLimiter } from "./rate-limit";

test("uses an atomic Redis increment-and-expire script when available", async () => {
  const calls: unknown[][] = [];
  const limiter = new RateLimiter(
    {
      incr: async () => {
        throw new Error("incr fallback should not be used");
      },
      expire: async () => 1,
      eval: async (...args: unknown[]) => {
        calls.push(args);
        return 1;
      },
    },
    { now: () => 0 },
  );

  const result = await limiter.check({
    key: "api:test",
    limit: 10,
    fallbackLimit: 2,
    windowSeconds: 60,
  });

  expect(result.source).toBe("redis");
  expect(result.allowed).toBe(true);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[1]).toBe(1);
  expect(calls[0]?.[2]).toBe("api:test:0");
  expect(calls[0]?.[3]).toBe("60");
});
