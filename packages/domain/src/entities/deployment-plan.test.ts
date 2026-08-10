import { describe, expect, test } from "bun:test";
import {
  DeploymentPlanSchema,
  parseDeploymentPlan,
  serializeDeploymentPlan,
} from "./deployment-plan";

const digest = `sha256:${"a".repeat(64)}`;

describe("DeploymentPlan", () => {
  test("captures immutable runtime, build, ownership, and artifact identity", () => {
    const plan = DeploymentPlanSchema.parse({
      version: 1,
      target: { kind: "remote-server", serverId: "server-1" },
      runtime: "docker",
      buildLocation: { kind: "remote-builder", serverId: "builder-1" },
      ownership: "local-control-plane",
      sourceRevision: "abcdef1234567",
      configurationVersion: "config-v1",
      buildConfig: {
        type: "railpack",
        autoDetect: true,
        buildPath: ".",
        railpackVersion: "0.15.4",
      },
      detectorVersion: "1.0.0",
      artifact: {
        digest,
        reference: `registry.example/upstand/app@${digest}`,
      },
      createdAt: "2026-08-09T12:00:00.000Z",
    });

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.target)).toBe(true);
    expect(parseDeploymentPlan(serializeDeploymentPlan(plan))).toEqual(plan);
  });

  test("rejects mutable tags and malformed digest identities", () => {
    expect(() =>
      DeploymentPlanSchema.parse({
        version: 1,
        target: { kind: "local" },
        runtime: "docker",
        buildLocation: { kind: "control-plane" },
        ownership: "local-control-plane",
        sourceRevision: "main",
        configurationVersion: "v1",
        buildConfig: { type: "static", publishDirectory: "." },
        detectorVersion: null,
        artifact: { digest: "latest", reference: "app:latest" },
        createdAt: "2026-08-09T12:00:00.000Z",
      }),
    ).toThrow();
    expect(parseDeploymentPlan("not-json")).toBeNull();
  });
});
