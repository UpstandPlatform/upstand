import { describe, expect, test } from "bun:test";
import {
  getTopologyRefetchInterval,
  TOPOLOGY_LIVE_REFRESH_INTERVAL_MS,
} from "./use-topology";

describe("topology refresh interval", () => {
  test("refreshes a live infrastructure snapshot at a bounded interval", () => {
    expect(TOPOLOGY_LIVE_REFRESH_INTERVAL_MS).toBe(30_000);
    expect(getTopologyRefetchInterval(true)).toBe(30_000);
  });

  test("does not poll when live sync is paused", () => {
    expect(getTopologyRefetchInterval(false)).toBe(false);
  });
});
