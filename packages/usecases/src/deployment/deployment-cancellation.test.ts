import { describe, expect, test } from "bun:test";
import {
  clearLocalDeploymentCancellation,
  deploymentCancellationKey,
  isLocalDeploymentCancellationRequested,
  requestLocalDeploymentCancellation,
} from "./deployment-cancellation";

describe("in-process deployment cancellation markers", () => {
  test("shares one key shape with the Redis-backed marker", () => {
    expect(deploymentCancellationKey("deployment-1")).toBe(
      "upstand:deployment:cancel:deployment-1",
    );
  });

  test("records and clears a cancellation request", () => {
    const key = deploymentCancellationKey("deployment-2");

    expect(isLocalDeploymentCancellationRequested(key)).toBe(false);
    requestLocalDeploymentCancellation(key);
    expect(isLocalDeploymentCancellationRequested(key)).toBe(true);
    clearLocalDeploymentCancellation(key);
    expect(isLocalDeploymentCancellationRequested(key)).toBe(false);
  });

  test("keeps deployments independent", () => {
    const first = deploymentCancellationKey("deployment-3");
    const second = deploymentCancellationKey("deployment-4");

    requestLocalDeploymentCancellation(first);

    expect(isLocalDeploymentCancellationRequested(first)).toBe(true);
    expect(isLocalDeploymentCancellationRequested(second)).toBe(false);
    clearLocalDeploymentCancellation(first);
  });
});
