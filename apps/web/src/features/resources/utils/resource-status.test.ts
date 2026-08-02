import { describe, expect, test } from "bun:test";
import { determineResourceRuntimeStatus } from "./resource-status";

describe("resource runtime status", () => {
  test("distinguishes healthy, degraded, starting, and failed observations", () => {
    expect(
      determineResourceRuntimeStatus("running", [{ state: "running" }]),
    ).toBe("running");
    expect(
      determineResourceRuntimeStatus("running", [
        { state: "running" },
        { state: "failed" },
      ]),
    ).toBe("degraded");
    expect(
      determineResourceRuntimeStatus("running", [{ status: "starting" }]),
    ).toBe("starting");
    expect(determineResourceRuntimeStatus("running", [{ state: "dead" }])).toBe(
      "errored",
    );
  });

  test("handles empty successful observations using persisted intent", () => {
    expect(determineResourceRuntimeStatus("running", [])).toBe("errored");
    expect(determineResourceRuntimeStatus("stopped", [])).toBe("stopped");
    expect(determineResourceRuntimeStatus("idle", [])).toBe("idle");
  });

  test("reports unknown when the live observation failed or is ambiguous", () => {
    expect(determineResourceRuntimeStatus("running", undefined)).toBe(
      "unknown",
    );
    expect(determineResourceRuntimeStatus("idle", [{ state: "paused" }])).toBe(
      "unknown",
    );
  });
});
