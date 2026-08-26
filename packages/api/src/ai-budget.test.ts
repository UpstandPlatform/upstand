import { describe, expect, test } from "bun:test";
import {
  recordUpGalUsage,
  renderUpGalBudgetMetrics,
  reserveUpGalDailyRunTokenAndCostBudget,
  reserveUpGalDailyTokenAndCostBudget,
  upGalConservativeCostPerMillionTokensUsd,
  upGalDailyCostBudgetKey,
  upGalDailyTokenBudgetKey,
  upGalUsageCostCentsForPricing,
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

  test("admits run, token, and cost budgets atomically", async () => {
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
        return [3, 5000, 37];
      },
    };

    const result = await reserveUpGalDailyRunTokenAndCostBudget(
      client,
      "org-1",
      100,
      5000,
      100_000,
      37,
      10_000,
      now,
    );

    expect(result).toEqual({
      totalRuns: 3,
      runLimit: 100,
      totalTokens: 5000,
      tokenLimit: 100_000,
      totalCents: 37,
      costLimitCents: 10_000,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.numberOfKeys).toBe(3);
    expect(calls[0]?.argumentsList.slice(0, 9)).toEqual([
      "upgal:daily-runs:org-1:2026-08-26",
      upGalDailyTokenBudgetKey("org-1", now),
      upGalDailyCostBudgetKey("org-1", now),
      "1",
      "100",
      "5000",
      "100000",
      "37",
      "10000",
    ]);
    expect(calls[0]?.script).toContain("currentRuns + requestedRuns");
    const script = calls[0]?.script ?? "";
    expect(script.indexOf("return 0")).toBeLessThan(script.indexOf("INCRBY"));
  });

  test("rejects the combined reservation without incrementing any budget", async () => {
    let calls = 0;
    const reservation = await reserveUpGalDailyRunTokenAndCostBudget(
      {
        eval: async () => {
          calls += 1;
          return 0;
        },
      },
      "org-1",
      100,
      5000,
      100_000,
      37,
      10_000,
      now,
    );
    expect(reservation).toBeNull();
    expect(calls).toBe(1);
  });

  test("fails closed on malformed combined reservation values", async () => {
    await expect(
      reserveUpGalDailyRunTokenAndCostBudget(
        { eval: async () => [1, 5000] },
        "org-1",
        100,
        5000,
        100_000,
        37,
        10_000,
        now,
      ),
    ).rejects.toThrow("invalid UpGal run, token, and cost reservation");
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

describe("UpGal usage cost observability", () => {
  test("raises admission cost coverage for a known expensive model", () => {
    expect(
      upGalConservativeCostPerMillionTokensUsd(0.01, {
        provider: "openai",
        modelId: "gpt-3.5-turbo",
      }),
    ).toBeGreaterThan(0.01);
    expect(
      upGalConservativeCostPerMillionTokensUsd(1000, {
        provider: "openai",
        modelId: "gpt-3.5-turbo",
      }),
    ).toBe(1000);
  });

  test("keeps the configured ceiling for unknown models", () => {
    expect(
      upGalConservativeCostPerMillionTokensUsd(100, {
        provider: "openai",
        modelId: "definitely-not-a-real-model",
      }),
    ).toBe(100);
  });

  test("calculates conservative cents from separate input and output rates", () => {
    expect(
      upGalUsageCostCentsForPricing(1_000_000, 500_000, {
        inputPerMTokensUsd: 2,
        outputPerMTokensUsd: 4,
      }),
    ).toBe(400);
  });

  test("does not estimate usage when a required rate is unavailable", () => {
    expect(
      upGalUsageCostCentsForPricing(10, 10, { inputPerMTokensUsd: 2 }),
    ).toBeNull();
    expect(() =>
      upGalUsageCostCentsForPricing(-1, 1, {
        inputPerMTokensUsd: 2,
        outputPerMTokensUsd: 4,
      }),
    ).toThrow("non-negative safe integers");
  });

  test("keeps unknown pricing visible in aggregate metrics", () => {
    recordUpGalUsage({
      provider: "openai",
      modelId: "definitely-not-a-real-model",
      inputTokens: 10,
      outputTokens: 10,
    });
    const metrics = renderUpGalBudgetMetrics();
    expect(metrics).toContain("upstand_ai_usage_unpriced_requests_total");
  });
});
