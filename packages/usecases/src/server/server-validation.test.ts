import { describe, expect, test } from "bun:test";
import { isServerReadyForWorkloads } from "./server-validation";

describe("server validation readiness", () => {
  test("blocks a failed deployment server even when Docker is reachable", () => {
    expect(
      isServerReadyForWorkloads({
        status: "failed",
        serverType: "deploy",
        docker: { swarmState: "active" },
      }),
    ).toBe(false);
  });

  test("allows a provisioned build server without Swarm", () => {
    expect(
      isServerReadyForWorkloads({
        status: "ready",
        serverType: "build",
        docker: { swarmState: "inactive" },
      }),
    ).toBe(true);
  });

  test("requires active Swarm for deployment and database servers", () => {
    for (const serverType of ["deploy", "database"] as const) {
      expect(
        isServerReadyForWorkloads({
          status: "ready",
          serverType,
          docker: { swarmState: "inactive" },
        }),
      ).toBe(false);
    }
  });
});
