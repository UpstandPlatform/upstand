import { describe, expect, test } from "bun:test";
import { shouldRecoverWorkerManager } from "./workers";

describe("schedules worker recovery", () => {
  const readyInput = {
    started: true,
    stopping: false,
    shutdownRequested: false,
    recoveryInFlight: false,
    workersReady: false,
    redisReady: true,
  };

  test("restarts workers only after Redis is healthy", () => {
    expect(shouldRecoverWorkerManager(readyInput)).toBe(true);
    expect(
      shouldRecoverWorkerManager({ ...readyInput, redisReady: false }),
    ).toBe(false);
  });

  test("does not restart during shutdown or while another recovery is active", () => {
    expect(shouldRecoverWorkerManager({ ...readyInput, stopping: true })).toBe(
      false,
    );
    expect(
      shouldRecoverWorkerManager({ ...readyInput, shutdownRequested: true }),
    ).toBe(false);
    expect(
      shouldRecoverWorkerManager({ ...readyInput, recoveryInFlight: true }),
    ).toBe(false);
  });

  test("does not restart healthy workers", () => {
    expect(
      shouldRecoverWorkerManager({ ...readyInput, workersReady: true }),
    ).toBe(false);
  });
});
