import { describe, expect, test } from "bun:test";
import { retryStartupOperation } from "./startup-retry";

describe("retryStartupOperation", () => {
  test("retries transient startup failures with bounded backoff", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await retryStartupOperation(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("dependency is not ready");
        return "ready";
      },
      {
        initialDelayMs: 10,
        maxDelayMs: 15,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      },
    );

    expect(result).toBe("ready");
    expect(attempts).toBe(3);
    expect(delays).toEqual([10, 15]);
  });

  test("rethrows the final error after exhausting attempts", async () => {
    const errors: unknown[] = [];
    let attempts = 0;

    await expect(
      retryStartupOperation(
        async () => {
          attempts += 1;
          throw new Error("dependency unavailable");
        },
        {
          attempts: 2,
          initialDelayMs: 0,
          sleep: async () => {},
          onRetry: ({ error }) => {
            errors.push(error);
          },
        },
      ),
    ).rejects.toThrow("dependency unavailable");

    expect(attempts).toBe(2);
    expect(errors).toHaveLength(1);
  });

  test("can keep retrying a critical startup dependency until it recovers", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await retryStartupOperation(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("dependency is still starting");
        return "ready";
      },
      {
        attempts: 1,
        retryForever: true,
        initialDelayMs: 10,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      },
    );

    expect(result).toBe("ready");
    expect(attempts).toBe(3);
    expect(delays).toEqual([10, 20]);
  });
});
