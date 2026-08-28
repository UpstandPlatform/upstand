import { describe, expect, test } from "bun:test";
import {
  incrementUpGalDailyBudget,
  reserveUpGalDailyTokenAndCostBudget,
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

  test("reserves worst-case token and cost ceilings atomically", async () => {
    const calls: unknown[][] = [];
    const now = new Date("2026-08-01T23:59:59.000Z");
    const reservation = await reserveUpGalDailyTokenAndCostBudget(
      {
        eval: async (...args: unknown[]) => {
          calls.push(args);
          return [4096, 328];
        },
      },
      "org-1",
      4096,
      1_000_000,
      328,
      10_000,
      now,
    );

    expect(reservation).toEqual({
      totalTokens: 4096,
      tokenLimit: 1_000_000,
      totalCents: 328,
      costLimitCents: 10_000,
    });
    expect(calls[0]?.[1]).toBe(2);
    expect(calls[0]?.[2]).toBe(
      upGalDailyTokenBudgetKey("org-1", new Date("2026-08-01T23:59:59.000Z")),
    );
    expect(calls[0]?.[3]).toBe(upGalDailyCostBudgetKey("org-1", now));
    expect(calls[0]?.[4]).toBe("4096");
    expect(calls[0]?.[5]).toBe("1000000");
    expect(calls[0]?.[6]).toBe("328");
    expect(calls[0]?.[7]).toBe("10000");
    expect(calls[0]?.[8]).toBe("1");
  });

  test("rejects a reservation that would exceed either combined budget", async () => {
    const reservation = await reserveUpGalDailyTokenAndCostBudget(
      { eval: async () => 0 },
      "org-1",
      4096,
      4096,
      328,
      10_000,
    );
    expect(reservation).toBeNull();
  });

  test("calculates a rounded conservative cost ceiling", () => {
    expect(upGalCostCentsForTokens(32_768, 100)).toBe(328);
    expect(upGalCostCentsForTokens(1, 0.01)).toBe(1);
  });
});
