import { describe, expect, test } from "bun:test";
import {
  DeploymentPlacementSchema,
  getPlatformCapabilities,
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
    expect(capabilities.localEdge).toBe(false);
    expect(capabilities.remoteServers).toBe(true);
    expect(capabilities.remoteEdge).toBe(true);
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
  });
});
