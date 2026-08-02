import { describe, expect, test } from "bun:test";
import {
  incrementUpGalDailyBudget,
  secondsUntilNextUtcDay,
  upGalDailyBudgetKey,
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
});
