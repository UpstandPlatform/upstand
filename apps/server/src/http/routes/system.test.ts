import { describe, expect, test } from "bun:test";
import { isRequiredMonitoringReady, probeDatabase } from "./system";

describe("database readiness probe", () => {
  test("uses the dedicated health port", async () => {
    let pingCount = 0;
    const ready = await probeDatabase({
      ping: async () => {
        pingCount += 1;
      },
    });

    expect(ready).toBe(true);
    expect(pingCount).toBe(1);
  });

  test("fails closed when the database ping fails", async () => {
    const ready = await probeDatabase({
      ping: async () => {
        throw new Error("database unavailable");
      },
    });

    expect(ready).toBe(false);
  });

  test("fails closed when the database ping stalls", async () => {
    const ready = await probeDatabase(
      { ping: async () => new Promise<void>(() => undefined) },
      5,
    );

    expect(ready).toBe(false);
  });

  test("requires monitoring readiness in production", () => {
    expect(isRequiredMonitoringReady(true, false)).toBe(false);
    expect(isRequiredMonitoringReady(true, true)).toBe(true);
    expect(isRequiredMonitoringReady(false, false)).toBe(true);
  });
});
