import { describe, expect, test } from "bun:test";
import {
  CHAT_RATE_LIMIT_MAX_REQUESTS,
  enforceChatRateLimit,
} from "./rate-limit";

describe("documentation chat rate limit", () => {
  test("uses an atomic Redis counter and returns bounded headers", async () => {
    const calls: unknown[][] = [];
    const result = await enforceChatRateLimit(
      new Request("https://docs.example.test/api/chat", {
        headers: { "x-forwarded-for": "203.0.113.9" },
      }),
      {
        eval: async (...args: unknown[]) => {
          calls.push(args);
          return [3, 57, 14, 49];
        },
      },
    );

    expect(result).toEqual({
      allowed: true,
      count: 3,
      remaining: CHAT_RATE_LIMIT_MAX_REQUESTS - 3,
      resetAfterSeconds: 57,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toBe(2);
    expect(calls[0]?.[4]).toBe("60");
    expect(String(calls[0]?.[2])).toMatch(
      /^fumadocs:chat:ratelimit:[a-f0-9]{64}$/,
    );
    expect(calls[0]?.[3]).toBe("fumadocs:chat:ratelimit:global");
  });

  test("fails closed when the counter response is malformed", async () => {
    await expect(
      enforceChatRateLimit(new Request("https://docs.example.test/api/chat"), {
        eval: async () => [1, 2],
      }),
    ).rejects.toThrow("invalid result");
  });

  test("enforces the deployment-wide budget independently of client identity", async () => {
    const result = await enforceChatRateLimit(
      new Request("https://docs.example.test/api/chat"),
      {
        eval: async () => [1, 59, 201, 59],
      },
    );

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});
