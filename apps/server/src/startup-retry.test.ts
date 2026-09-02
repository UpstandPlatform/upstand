import { describe, expect, test } from "bun:test";
import { retryStartupOperation } from "./startup-retry";

describe("retryStartupOperation", () => {
  test("retries a transient startup failure with exponential delays", async () => {
    let attempts = 0;
    const delays: number[] = [];

    await expect(
      retryStartupOperation(
        async () => {
          attempts += 1;
          if (attempts < 3) throw new Error("dependency unavailable");
          return "ready";
        },
        {
          initialDelayMs: 10,
          maxDelayMs: 15,
          sleep: async (delayMs) => {
            delays.push(delayMs);
          },
        },
      ),
    ).resolves.toBe("ready");

    expect(attempts).toBe(3);
    expect(delays).toEqual([10, 15]);
  });

  test("rethrows the final startup error after the configured attempts", async () => {
    let attempts = 0;
    const onRetry: Array<{ attempt: number; delayMs: number }> = [];

    await expect(
      retryStartupOperation(
        async () => {
          attempts += 1;
          throw new Error("dependency unavailable");
        },
        {
          attempts: 2,
          initialDelayMs: 0,
          sleep: async () => undefined,
          onRetry: ({ attempt, delayMs }) => {
            onRetry.push({ attempt, delayMs });
          },
        },
      ),
    ).rejects.toThrow("dependency unavailable");

    expect(attempts).toBe(2);
    expect(onRetry).toEqual([{ attempt: 1, delayMs: 0 }]);
  });

  test("can keep retrying transient dependencies until they recover", async () => {
    let attempts = 0;

    await expect(
      retryStartupOperation(
        async () => {
          attempts += 1;
          if (attempts < 14) throw new Error("dependency unavailable");
          return "ready";
        },
        {
          attempts: Number.POSITIVE_INFINITY,
          initialDelayMs: 0,
          sleep: async () => undefined,
        },
      ),
    ).resolves.toBe("ready");

    expect(attempts).toBe(14);
  });
});
