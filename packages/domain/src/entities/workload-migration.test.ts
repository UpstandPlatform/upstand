import { describe, expect, test } from "bun:test";
import {
  assertWorkloadMigrationTransition,
  WorkloadMigrationCheckpointSchema,
} from "./workload-migration";

describe("workload migration state machine", () => {
  test("accepts the production cutover path", () => {
    const transitions = [
      ["queued", "preflight"],
      ["preflight", "transferring"],
      ["transferring", "shadow-deploying"],
      ["shadow-deploying", "validating"],
      ["validating", "cutting-over"],
      ["cutting-over", "awaiting-confirmation"],
      ["awaiting-confirmation", "completed"],
    ] as const;
    for (const [from, to] of transitions) {
      expect(() => assertWorkloadMigrationTransition(from, to)).not.toThrow();
    }
  });

  test("rejects skipped and terminal transitions", () => {
    expect(() =>
      assertWorkloadMigrationTransition("queued", "cutting-over"),
    ).toThrow();
    expect(() =>
      assertWorkloadMigrationTransition("completed", "preflight"),
    ).toThrow();
  });

  test("forbids sensitive values from being named in durable checkpoints", () => {
    expect(() =>
      WorkloadMigrationCheckpointSchema.parse({ password: "plaintext" }),
    ).toThrow("Sensitive checkpoint keys are forbidden");
    expect(
      WorkloadMigrationCheckpointSchema.parse({
        artifactDigest: "sha256:abc",
        volumeCount: 2,
      }),
    ).toEqual({ artifactDigest: "sha256:abc", volumeCount: 2 });
  });
});
