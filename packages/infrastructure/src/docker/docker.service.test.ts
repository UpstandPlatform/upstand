import { describe, expect, mock, test } from "bun:test";
import { Readable } from "node:stream";
import {
  DockerService,
  redactCommandOutput,
  shouldSuppressComposeRestart,
} from "./docker.service";

describe("deployment command log safety", () => {
  test("redacts build and registry secrets without leaking shorter values", () => {
    expect(
      redactCommandOutput("token=super-secret and token=secret", [
        "secret",
        "super-secret",
      ]),
    ).toBe("token=[REDACTED] and token=[REDACTED]");
  });

  test("does not include secret-bearing command arguments in the failure format", () => {
    expect(
      redactCommandOutput("docker login --password-stdin registry.example", [
        "registry-password",
      ]),
    ).not.toContain("registry-password");
  });

  test("suppresses restart-policy recreation only for standalone Compose kill", () => {
    expect(
      shouldSuppressComposeRestart(
        { type: "compose", composeType: "compose" },
        "kill",
      ),
    ).toBe(true);
    expect(
      shouldSuppressComposeRestart(
        { type: "compose", composeType: "stack" },
        "kill",
      ),
    ).toBe(false);
    expect(
      shouldSuppressComposeRestart(
        { type: "application", composeType: null },
        "kill",
      ),
    ).toBe(false);
  });

  test("marks images from builders without native label flags for rollback", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const service = new DockerService({} as never) as unknown as {
      markImageForRollback: (
        imageName: string,
        onLog: (message: string) => void,
      ) => Promise<void>;
      runCommandAsync: (
        command: string,
        args: string[],
        onLog: (message: string) => void,
      ) => Promise<void>;
    };
    service.runCommandAsync = async (command, args) => {
      calls.push({ command, args });
    };

    await service.markImageForRollback("upstand-app-resource:latest", () => {});

    const createArgs = calls[0]?.args;
    const commitArgs = calls[1]?.args;
    const markerImage = commitArgs?.[4];
    const containerName = createArgs?.[2];
    if (typeof markerImage !== "string" || typeof containerName !== "string") {
      throw new Error("Rollback marker command was not recorded");
    }
    expect(createArgs?.[0]).toBe("create");
    expect(commitArgs).toEqual([
      "commit",
      "--change",
      "LABEL com.upstand.rollback.keep=true",
      containerName,
      markerImage,
    ]);
    expect(calls[2]?.args).toEqual([
      "tag",
      markerImage,
      "upstand-app-resource:latest",
    ]);
    expect(calls[3]?.args).toEqual(["rm", "--force", containerName]);
    expect(calls[4]?.args).toEqual(["image", "rm", markerImage]);
  });

  test("skips the post-deploy smoke test when it is disabled", async () => {
    const service = new DockerService({} as never);
    const result = await service.runPostDeploySmokeTest(
      { advancedConfig: "{}" } as never,
      () => {},
    );
    expect(result).toBeNull();
  });

  test("applies explicit capability drops when applying advanced config", () => {
    const service = new DockerService({} as never) as unknown as {
      applyAdvancedConfig: (
        resource: unknown,
        containerSpec: Record<string, unknown>,
        taskTemplate: Record<string, unknown>,
        endpointSpec: Record<string, unknown>,
      ) => void;
    };
    const containerSpec: Record<string, unknown> = {};

    service.applyAdvancedConfig(
      {
        advancedConfig: JSON.stringify({
          capDrop: ["NET_BIND_SERVICE"],
        }),
      },
      containerSpec,
      {},
      {},
    );

    expect(containerSpec).toMatchObject({
      Privileged: false,
      SecurityOpt: ["no-new-privileges:true"],
      CapDrop: ["ALL", "NET_BIND_SERVICE"],
    });
  });

  test("bounds output collected from resource container commands", async () => {
    const stream = Readable.from([Buffer.alloc(2_048)]);
    const docker = {
      listServices: async () => [{ Spec: { Name: "resource-1" } }],
      listTasks: async () => [
        {
          ID: "task-1",
          Status: {
            State: "running",
            ContainerStatus: { ContainerID: "container-1" },
          },
        },
      ],
      listNodes: async () => [],
      getContainer: () => ({
        exec: async () => ({ start: async () => stream }),
      }),
    } as never;
    const service = new DockerService(docker);

    await expect(
      service.runCommandInResourceContainer(
        {
          id: "resource-1",
          name: "Resource 1",
          appName: "resource-1",
        } as never,
        "printf output",
        undefined,
        { maxOutputBytes: 1_024, timeoutSeconds: 2 },
      ),
    ).rejects.toThrow("output exceeded");
  });

  test("fails when a resource container command exits non-zero", async () => {
    const docker = {
      listServices: async () => [{ Spec: { Name: "resource-1" } }],
      listTasks: async () => [
        {
          ID: "task-1",
          Status: {
            State: "running",
            ContainerStatus: { ContainerID: "container-1" },
          },
        },
      ],
      listNodes: async () => [],
      getContainer: () => ({
        exec: async () => ({
          start: async () => Readable.from([Buffer.from("migration failed")]),
          inspect: async () => ({ ExitCode: 17 }),
        }),
      }),
    } as never;
    const service = new DockerService(docker);

    await expect(
      service.runCommandInResourceContainer(
        {
          id: "resource-1",
          name: "Resource 1",
          appName: "resource-1",
        } as never,
        "false",
      ),
    ).rejects.toThrow("exited with code 17");
  });

  test("fails closed when a requested hook service is not running", async () => {
    const getContainer = mock(() => ({
      exec: mock(),
    }));
    const service = new DockerService({
      listContainers: async () => [
        { Id: "other-container", Names: ["/other-service"] },
      ],
      getContainer,
    } as never);

    await expect(
      service.execContainerCommand(
        { kind: "local", name: "Target" },
        "missing-service",
        "id",
      ),
    ).rejects.toThrow(
      "No running container found for service 'missing-service'",
    );
    expect(getContainer).not.toHaveBeenCalled();
  });

  test("does not match a similarly named hook service", async () => {
    const getContainer = mock(() => ({
      exec: mock(),
    }));
    const service = new DockerService({
      listContainers: async () => [
        { Id: "similar-container", Names: ["/resource-app-old"] },
      ],
      getContainer,
    } as never);

    await expect(
      service.execContainerCommand(
        { kind: "local", name: "Target" },
        "resource-app",
        "id",
      ),
    ).rejects.toThrow("No running container found for service 'resource-app'");
    expect(getContainer).not.toHaveBeenCalled();
  });

  test("bounds concurrent server container stats requests", async () => {
    const service = new DockerService({
      info: async () => ({
        Name: "docker",
        ServerVersion: "1",
        OperatingSystem: "linux",
        KernelVersion: "1",
        Architecture: "amd64",
        NCPU: 4,
        MemTotal: 1_024 * 1_024 * 1_024,
      }),
      listContainers: async () =>
        Array.from({ length: 40 }, (_, index) => ({
          Id: `container-${index}`,
        })),
      df: async () => ({}),
    } as never) as unknown as {
      getContainerStats: (
        containerId: string,
        resolveSwarmTask?: boolean,
      ) => Promise<{
        cpu: number;
        ram: number;
        ramUsage: number;
        ramLimit: number;
        networkRxBytes: number;
        networkTxBytes: number;
      }>;
      getServerRuntimeStats: () => ReturnType<
        DockerService["getServerRuntimeStats"]
      >;
    };
    let activeRequests = 0;
    let maxActiveRequests = 0;
    service.getContainerStats = async () => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeRequests -= 1;
      return {
        cpu: 1,
        ram: 0,
        ramUsage: 1,
        ramLimit: 2,
        networkRxBytes: 3,
        networkTxBytes: 4,
      };
    };

    const result = await service.getServerRuntimeStats();

    expect(maxActiveRequests).toBe(16);
    expect(result.activeContainers).toBe(40);
    expect(result.cpu).toBe(40);
  });
});
