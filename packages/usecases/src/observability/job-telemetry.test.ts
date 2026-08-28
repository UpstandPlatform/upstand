import { describe, expect, test } from "bun:test";
import { getJobTelemetryMetrics, withJobTelemetry } from "./job-telemetry";

describe("job telemetry metrics", () => {
  test("records bounded success and failure lifecycle metrics without job identifiers", async () => {
    const before = getJobTelemetryMetrics();

    await withJobTelemetry(
      {
        operation: "deployment.execute",
        queue: "deployment:server-1",
        jobId: "job-1",
      },
      async () => undefined,
    );
    await expect(
      withJobTelemetry(
        {
          operation: "deployment.execute",
          queue: "deployment:server-1",
          jobId: "another-job-id",
        },
        async () => {
          throw new Error("expected failure");
        },
      ),
    ).rejects.toThrow("expected failure");

    const after = getJobTelemetryMetrics();
    const success = after.find(
      (metric) =>
        metric.operation === "deployment.execute" &&
        metric.outcome === "success",
    );
    const failure = after.find(
      (metric) =>
        metric.operation === "deployment.execute" &&
        metric.outcome === "failure",
    );
    expect(success?.count ?? 0).toBeGreaterThan(
      before.find(
        (metric) =>
          metric.operation === "deployment.execute" &&
          metric.outcome === "success",
      )?.count ?? 0,
    );
    expect(failure?.count ?? 0).toBeGreaterThan(
      before.find(
        (metric) =>
          metric.operation === "deployment.execute" &&
          metric.outcome === "failure",
      )?.count ?? 0,
    );
    expect(JSON.stringify(after)).not.toContain("job-1");
    expect(JSON.stringify(after)).not.toContain("server-1");
  });

  test("normalizes malformed operation labels to a bounded fallback", async () => {
    await withJobTelemetry(
      { operation: 'deployment\n{job="leak"}', queue: "queue" },
      async () => undefined,
    );

    expect(getJobTelemetryMetrics()).toContainEqual(
      expect.objectContaining({ operation: "other", outcome: "success" }),
    );
  });
});
