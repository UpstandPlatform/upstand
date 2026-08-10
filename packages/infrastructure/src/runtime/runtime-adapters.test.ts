import { describe, expect, test } from "bun:test";
import type {
  BareArtifactMaterializerPort,
  CloudGatewayPort,
  ProcessSupervisorPort,
} from "@upstand/usecases";
import { CLOUD_GATEWAY_CONTRACT_VERSION } from "@upstand/usecases";
import { BareProcessRuntimeAdapter } from "./bare-process-runtime.adapter";
import { CloudRuntimeAdapter } from "./cloud-runtime.adapter";

describe("runtime adapters", () => {
  test("bare process delegates lifecycle to the platform supervisor", async () => {
    const calls: string[] = [];
    const supervisor = {
      platform: "linux",
      install: async () => {
        calls.push("install");
      },
      status: async () => ({ healthy: true, state: "running", message: null }),
      logs: async () => "line",
      restart: async () => {
        calls.push("restart");
      },
      remove: async () => {
        calls.push("remove");
      },
    } satisfies ProcessSupervisorPort;
    const materializer = {
      materialize: async () => ({
        executable: "/opt/upstand/app",
        args: [],
        workingDirectory: "/opt/upstand",
        environmentFile: "/opt/upstand/runtime.env",
      }),
    } satisfies BareArtifactMaterializerPort;
    const adapter = new BareProcessRuntimeAdapter(supervisor, materializer);
    const resource = { id: "Resource_1" } as never;
    const request = {
      deploymentId: "deployment-1",
      plan: {
        runtime: "bare-process",
        artifact: { reference: "artifact", digest: `sha256:${"a".repeat(64)}` },
      },
      resource,
      environment: {},
    } as never;
    await adapter.deploy(request);
    await adapter.rollback(request);
    await adapter.remove(resource);
    expect(calls).toEqual(["install", "install", "remove"]);
  });

  test("cloud runtime delegates without making a local data copy", async () => {
    const calls: string[] = [];
    const gateway = {
      contractVersion: CLOUD_GATEWAY_CONTRACT_VERSION,
      deploy: async (input) => {
        calls.push(input.cloudProjectId);
        return {
          runtimeId: "remote-runtime",
          endpoint: null,
          artifact: input.plan.artifact,
        };
      },
      health: async () => ({ healthy: true, state: "ready", message: null }),
      logs: async () => "",
      rollback: async () => {},
      remove: async () => {},
      promote: async () => ({ cloudProjectId: "cloud-1" }),
      bringHome: async () => ({ transferId: "transfer-1" }),
    } satisfies CloudGatewayPort;
    const adapter = new CloudRuntimeAdapter(gateway);
    await adapter.deploy({
      deploymentId: "deployment-1",
      plan: {
        runtime: "cloud",
        target: { kind: "cloud", cloudProjectId: "cloud-1" },
      },
    } as never);
    expect(calls).toEqual(["cloud-1"]);
  });

  test("cloud runtime rejects an incompatible gateway contract", () => {
    expect(
      () =>
        new CloudRuntimeAdapter({
          contractVersion: "2025-01-01",
        } as never),
    ).toThrow("Cloud gateway contract mismatch");
  });
});
