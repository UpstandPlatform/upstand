import { describe, expect, test } from "bun:test";
import {
  isImmutableImageReference,
  waitForMonitoringHealth,
} from "./monitoring-agent";

describe("monitoring image references", () => {
  test("accepts a complete immutable digest reference", () => {
    expect(
      isImmutableImageReference(
        "ghcr.io/upstandplatform/upstand-monitoring:v1.2.3@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    ).toBe(true);
  });

  test("rejects mutable tags and incomplete digests", () => {
    expect(
      isImmutableImageReference(
        "ghcr.io/upstandplatform/upstand-monitoring:latest",
      ),
    ).toBe(false);
    expect(
      isImmutableImageReference(
        "ghcr.io/upstandplatform/upstand-monitoring:v1.2.3@sha256:abc",
      ),
    ).toBe(false);
  });

  test("waits for a running monitoring container to become healthy", async () => {
    let inspections = 0;
    await waitForMonitoringHealth(
      {
        inspect: async () => {
          inspections += 1;
          return {
            State: {
              Running: true,
              Health: { Status: inspections === 1 ? "starting" : "healthy" },
            },
          };
        },
      },
      2_000,
    );
    expect(inspections).toBe(2);
  });

  test("fails closed when the monitoring container is unhealthy", async () => {
    await expect(
      waitForMonitoringHealth(
        {
          inspect: async () => ({
            State: {
              Running: true,
              Health: { Status: "unhealthy" },
              ExitCode: 1,
              Error: "probe failed",
            },
          }),
        },
        2_000,
      ),
    ).rejects.toThrow("Monitoring Agent container is not healthy");
  });
});
