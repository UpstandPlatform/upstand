import { describe, expect, test } from "bun:test";
import {
  assertRuntimeCapability,
  DataOwnershipSchema,
  DeploymentPlacementSchema,
  DeployTargetSchema,
  ExecutionRuntimeSchema,
  getPlatformCapabilities,
  PlatformCapabilityError,
  resolveControlPlaneMode,
} from "./platform.types";

describe("platform types", () => {
  test("resolves explicit platform modes before legacy cloud fallback", () => {
    expect(
      resolveControlPlaneMode({ platform: "desktop", isCloud: true }),
    ).toBe("desktop");
    expect(
      resolveControlPlaneMode({ platform: undefined, isCloud: true }),
    ).toBe("cloud");
    expect(
      resolveControlPlaneMode({ platform: "invalid", isCloud: false }),
    ).toBe("self-hosted");
  });

  test("keeps cloud control planes remote-only", () => {
    const capabilities = getPlatformCapabilities("cloud");
    expect(capabilities.localRuntime).toBe(false);
    expect(capabilities.remoteServers).toBe(true);
    expect(capabilities.acmeCertificates).toBe(true);
    expect(capabilities.localGitCli).toBe(false);
    expect(capabilities.swarmManagement).toBe(false);
    expect(capabilities.enterpriseScimSso).toBe(true);
    expect(capabilities.dataOwnership).toBe("cloud-control-plane");
  });

  test("defines desktop control plane capabilities", () => {
    const capabilities = getPlatformCapabilities("desktop");
    expect(capabilities.localRuntime).toBe(true);
    expect(capabilities.acmeCertificates).toBe(false);
    expect(capabilities.localGitCli).toBe(true);
    expect(capabilities.localDockerSocket).toBe(true);
    expect(capabilities.swarmManagement).toBe(false);
    expect(capabilities.desktopNativeNotifications).toBe(true);
    expect(capabilities.enterpriseScimSso).toBe(false);
    expect(capabilities.dataOwnership).toBe("local-control-plane");
  });

  test("defines self-hosted control plane capabilities", () => {
    const capabilities = getPlatformCapabilities("self-hosted");
    expect(capabilities.localRuntime).toBe(true);
    expect(capabilities.acmeCertificates).toBe(true);
    expect(capabilities.swarmManagement).toBe(true);
    expect(capabilities.enterpriseScimSso).toBe(true);
  });

  test("validates deployment placement as a discriminated union", () => {
    expect(DeploymentPlacementSchema.parse({ kind: "local" })).toEqual({
      kind: "local",
    });
    expect(
      DeploymentPlacementSchema.parse({
        kind: "remote-server",
        serverId: "server-1",
      }),
    ).toEqual({ kind: "remote-server", serverId: "server-1" });
    expect(() =>
      DeploymentPlacementSchema.parse({
        kind: "remote-server",
        serverId: "",
      }),
    ).toThrow();
    expect(
      DeploymentPlacementSchema.parse({
        kind: "cloud",
        cloudProjectId: "cloud-project-1",
      }),
    ).toEqual({ kind: "cloud", cloudProjectId: "cloud-project-1" });
  });

  test("defines target, execution, and ownership as separate concepts", () => {
    expect(DeployTargetSchema.parse("remote-server")).toBe("remote-server");
    expect(ExecutionRuntimeSchema.parse("bare-process")).toBe("bare-process");
    expect(DataOwnershipSchema.parse("cloud-control-plane")).toBe(
      "cloud-control-plane",
    );
  });

  test("fails closed for unsupported target/runtime/build combinations", () => {
    expect(
      assertRuntimeCapability({
        mode: "self-hosted",
        target: "remote-server",
        runtime: "docker",
        buildLocation: "remote-builder",
      }).zeroDowntimeReplacement,
    ).toBe(true);

    expect(() =>
      assertRuntimeCapability({
        mode: "cloud",
        target: "local",
        runtime: "docker",
        buildLocation: "control-plane",
      }),
    ).toThrow(PlatformCapabilityError);

    expect(() =>
      assertRuntimeCapability({
        mode: "desktop",
        target: "remote-server",
        runtime: "bare-process",
        buildLocation: "cloud",
      }),
    ).toThrow("not supported");
  });
});
