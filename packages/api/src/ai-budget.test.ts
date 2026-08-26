import { describe, expect, test } from "bun:test";
import {
  reserveUpGalDailyTokenAndCostBudget,
  upGalDailyCostBudgetKey,
  upGalDailyTokenBudgetKey,
} from "./ai-budget";

describe("UpGal atomic token and cost budgets", () => {
  const now = new Date("2026-08-26T12:34:56.000Z");

  test("checks and reserves both budgets with one two-key Redis script", async () => {
    const calls: Array<{
      script: string;
      numberOfKeys: number;
      argumentsList: string[];
    }> = [];
    const client = {
      eval: async (
        script: string,
        numberOfKeys: number,
        ...argumentsList: string[]
      ) => {
        calls.push({ script, numberOfKeys, argumentsList });
        return [5000, 37];
      },
    };

    const result = await reserveUpGalDailyTokenAndCostBudget(
      client,
      "org-1",
      5000,
      100_000,
      37,
      10_000,
      now,
    );

    expect(result).toEqual({
      totalTokens: 5000,
      tokenLimit: 100_000,
      totalCents: 37,
      costLimitCents: 10_000,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.numberOfKeys).toBe(2);
    expect(calls[0]?.argumentsList.slice(0, 6)).toEqual([
      upGalDailyTokenBudgetKey("org-1", now),
      upGalDailyCostBudgetKey("org-1", now),
      "5000",
      "100000",
      "37",
      "10000",
    ]);
    const script = calls[0]?.script ?? "";
    expect(script).toContain("currentTokens + requestedTokens");
    expect(script).toContain("currentCents + requestedCents");
    expect(script.indexOf("return 0")).toBeLessThan(script.indexOf("INCRBY"));
  });

  test("does not admit a rejected combined reservation", async () => {
    let calls = 0;
    const client = {
      eval: async () => {
        calls += 1;
        return 0;
      },
    };

    await expect(
      reserveUpGalDailyTokenAndCostBudget(
        client,
        "org-1",
        5000,
        100_000,
        37,
        10_000,
        now,
      ),
    ).resolves.toBeNull();
    expect(calls).toBe(1);
  });

  test("fails closed on malformed Redis success values", async () => {
    const client = { eval: async () => ["5000"] };
    await expect(
      reserveUpGalDailyTokenAndCostBudget(
        client,
        "org-1",
        5000,
        100_000,
        37,
        10_000,
        now,
      ),
    ).rejects.toThrow("invalid UpGal token and cost reservation");
  });

  test("rejects unsafe budget inputs before contacting Redis", async () => {
    let calls = 0;
    const client = {
      eval: async () => {
        calls += 1;
        return [1, 1];
      },
    };

    await expect(
      reserveUpGalDailyTokenAndCostBudget(
        client,
        "org-1",
        0,
        100_000,
        1,
        10_000,
        now,
      ),
    ).rejects.toThrow("positive safe integers");
    expect(calls).toBe(0);
  });
});
