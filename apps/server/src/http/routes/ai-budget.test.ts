import { describe, expect, test } from "bun:test";
import {
  incrementUpGalDailyBudget,
  reserveUpGalDailyCostBudget,
  reserveUpGalDailyTokenBudget,
  secondsUntilNextUtcDay,
  upGalCostCentsForTokens,
  upGalDailyBudgetKey,
  upGalDailyCostBudgetKey,
  upGalDailyTokenBudgetKey,
} from "./ai-budget";

describe("UpGal daily budget", () => {
  test("uses the UTC calendar date in the key", () => {
    expect(
      upGalDailyBudgetKey("org-1", new Date("2026-08-01T23:59:00.000Z")),
    ).toBe("upgal:daily-runs:org-1:2026-08-01");
  });

  test("expires at the next UTC day instead of a short fixed window", () => {
    expect(secondsUntilNextUtcDay(new Date("2026-08-01T23:59:00.000Z"))).toBe(
      60,
    );
    expect(secondsUntilNextUtcDay(new Date("2026-08-01T00:00:00.000Z"))).toBe(
      86_400,
    );
  });

  test("increments the budget and expiry atomically through Redis", async () => {
    const calls: unknown[][] = [];
    const count = await incrementUpGalDailyBudget(
      {
        eval: async (...args: unknown[]) => {
          calls.push(args);
          return "7";
        },
      },
      "org-1",
      new Date("2026-08-01T23:59:59.000Z"),
    );

    expect(count).toBe(7);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toBe(1);
    expect(calls[0]?.[2]).toBe(
      upGalDailyBudgetKey("org-1", new Date("2026-08-01T23:59:59.000Z")),
    );
    expect(calls[0]?.[3]).toBe("1");
  });

  test("reserves a worst-case token ceiling atomically", async () => {
    const calls: unknown[][] = [];
    const reservation = await reserveUpGalDailyTokenBudget(
      {
        eval: async (...args: unknown[]) => {
          calls.push(args);
          return "4096";
        },
      },
      "org-1",
      4096,
      1_000_000,
      new Date("2026-08-01T23:59:59.000Z"),
    );

    expect(reservation).toEqual({ totalTokens: 4096, limit: 1_000_000 });
    expect(calls[0]?.[1]).toBe(1);
    expect(calls[0]?.[2]).toBe(
      upGalDailyTokenBudgetKey("org-1", new Date("2026-08-01T23:59:59.000Z")),
    );
    expect(calls[0]?.[3]).toBe("4096");
    expect(calls[0]?.[4]).toBe("1000000");
    expect(calls[0]?.[5]).toBe("1");
  });

  test("rejects a reservation that would exceed the token budget", async () => {
    const reservation = await reserveUpGalDailyTokenBudget(
      { eval: async () => "0" },
      "org-1",
      4096,
      4096,
    );
    expect(reservation).toBeNull();
  });

  test("calculates a rounded conservative cost ceiling", () => {
    expect(upGalCostCentsForTokens(32_768, 100)).toBe(328);
    expect(upGalCostCentsForTokens(1, 0.01)).toBe(1);
  });

  test("reserves the daily cost ceiling atomically in cents", async () => {
    const calls: unknown[][] = [];
    const now = new Date("2026-08-01T23:59:59.000Z");
    const reservation = await reserveUpGalDailyCostBudget(
      {
        eval: async (...args: unknown[]) => {
          calls.push(args);
          return "328";
        },
      },
      "org-1",
      328,
      10_000,
      now,
    );

    expect(reservation).toEqual({ totalCents: 328, limitCents: 10_000 });
    expect(calls[0]?.[2]).toBe(upGalDailyCostBudgetKey("org-1", now));
    expect(calls[0]?.[3]).toBe("328");
    expect(calls[0]?.[4]).toBe("10000");
    expect(calls[0]?.[5]).toBe("1");
  });
});
