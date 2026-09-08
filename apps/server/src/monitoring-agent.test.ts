import { describe, expect, spyOn, test } from "bun:test";
import {
  isImmutableImageReference,
  probeLocalMonitoringHealth,
  waitForMonitoringHealth,
} from "./monitoring-agent";

describe("monitoring image references", () => {
  test("probes current collection health and fails closed on unavailable or malformed responses", async () => {
    const request = spyOn(globalThis, "fetch");
    try {
      request.mockResolvedValueOnce(Response.json({ status: "ok" }));
      expect(await probeLocalMonitoringHealth()).toBe(true);
      request.mockResolvedValueOnce(
        Response.json({ status: "degraded" }, { status: 503 }),
      );
      expect(await probeLocalMonitoringHealth()).toBe(false);
      request.mockResolvedValueOnce(Response.json({ status: "starting" }));
      expect(await probeLocalMonitoringHealth()).toBe(false);
      request.mockResolvedValueOnce(new Response("invalid JSON"));
      expect(await probeLocalMonitoringHealth()).toBe(false);
      request.mockRejectedValueOnce(new Error("network unavailable"));
      expect(await probeLocalMonitoringHealth()).toBe(false);
    } finally {
      request.mockRestore();
    }
  });
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
