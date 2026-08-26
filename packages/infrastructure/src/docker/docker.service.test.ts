import { describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  DockerService,
  redactCommandOutput,
  shouldSuppressComposeRestart,
} from "./docker.service";
import type { DockerResourceCommandBrokerPort } from "./docker-broker-client";

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

  test("uses the typed resource command broker for local resource commands", async () => {
    const execContainerCommand = mock(async () => ({
      output: "migration ok",
      exitCode: 0,
    }));
    const getContainer = mock();
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
      getContainer,
    } as never;
    const broker = {
      execContainerCommand,
      execResourceServiceCommand: mock(),
    } as unknown as DockerResourceCommandBrokerPort;
    const service = new DockerService(docker, {}, broker);

    await expect(
      service.runCommandInResourceContainer(
        {
          id: "resource-1",
          name: "Resource 1",
          appName: "resource-1",
        } as never,
        "printf output",
        undefined,
        { maxOutputBytes: 4_096, timeoutSeconds: 2 },
      ),
    ).resolves.toBe("migration ok");
    expect(execContainerCommand).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      undefined,
      "printf output",
      { timeoutSeconds: 2, maxOutputBytes: 4_096 },
      "resource-1",
    );
    expect(getContainer).not.toHaveBeenCalled();
  });

  test("uses typed resource service mutation for local image deployment", async () => {
    const upsertResourceService = mock(async () => {});
    const ensureResourceServiceNetwork = mock(async () => {});
    const broker = {
      upsertResourceService,
      ensureResourceServiceNetwork,
      execContainerCommand: mock(),
      execResourceServiceCommand: mock(),
    } as unknown as DockerResourceCommandBrokerPort;
    const docker = {
      info: async () => ({
        Swarm: { LocalNodeState: "active", ControlAvailable: true },
      }),
      getNetwork: () => ({
        inspect: async () => ({
          Id: "network-1",
          Driver: "overlay",
          Scope: "swarm",
          Attachable: true,
          Options: { encrypted: "" },
        }),
      }),
      pull: async () => "pull-stream" as never,
      modem: {
        followProgress: (
          _stream: unknown,
          onFinished: (error?: unknown) => void,
        ) => onFinished(),
      },
    } as never;
    const service = new DockerService(docker, {}, broker);

    await service.deployAppImage(
      {
        id: "resource-1",
        name: "Resource 1",
        appName: "resource-1",
        dockerImage: "example/app:latest",
        advancedConfig: "{}",
      } as never,
      {},
      undefined,
      undefined,
      {
        username: "builder",
        password: "temporary",
        serveraddress: "registry.example",
      },
    );

    expect(upsertResourceService).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "resource-1",
      "resource-1",
      expect.objectContaining({
        Name: "resource-1",
        Labels: { "com.upstand.resource-id": "resource-1" },
      }),
      {
        registryAuth: {
          username: "builder",
          password: "temporary",
          serveraddress: "registry.example",
        },
      },
    );
    expect(ensureResourceServiceNetwork).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "resource-1",
      "resource-1",
      "network-1",
    );
  });

  test("uses the typed owned-service removal for local deployment revisions", async () => {
    const removeResourceService = mock(async () => {});
    const broker = {
      removeResourceService,
    } as unknown as DockerResourceCommandBrokerPort;
    const service = new DockerService(
      {
        getService: () => ({
          inspect: async () => ({
            Spec: {
              Labels: {
                "com.upstand.resource-id": "resource-1",
                "com.upstand.deployment-revision": "true",
              },
            },
          }),
          remove: mock(async () => {}),
        }),
      } as never,
      {},
      broker,
    );

    await service.removeServiceRevision(
      {
        id: "resource-1",
        name: "Resource 1",
        appName: "resource-1",
      } as never,
      "resource-1-preview",
    );

    expect(removeResourceService).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "resource-1",
      "resource-1-preview",
    );
  });

  test("uses the typed owned-network removal for isolated local resources", async () => {
    const removeResourceService = mock(async () => {});
    const removeResourceNetwork = mock(async () => {});
    const removeResourceVolume = mock(async () => {});
    const getNetwork = mock();
    const broker = {
      removeResourceService,
      removeResourceNetwork,
      removeResourceVolume,
    } as unknown as DockerResourceCommandBrokerPort;
    const docker = {
      listContainers: async () => [],
      getNetwork,
    } as never;
    const service = new DockerService(docker, {}, broker);

    await service.removeResource(
      {
        id: "resource-1",
        name: "Resource 1",
        appName: "resource-1",
        type: "application",
        advancedConfig: JSON.stringify({ isolatedDeployment: true }),
      } as never,
      true,
    );

    expect(removeResourceNetwork).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "resource-1",
      "upstand-resource-resource-1",
    );
    expect(getNetwork).not.toHaveBeenCalled();
    expect(removeResourceVolume).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "resource-1",
      "upstand-db-data-resource-1",
    );
  });

  test("uses the typed ownership-checked teardown for local Compose resources", async () => {
    const removeResourceCompose = mock(async () => {});
    const removeResourceNetwork = mock(async () => {});
    const broker = {
      removeResourceCompose,
      removeResourceNetwork,
    } as unknown as DockerResourceCommandBrokerPort;
    const service = new DockerService(
      { listContainers: async () => [] } as never,
      {},
      broker,
    );

    await service.removeResource(
      {
        id: "resource-1",
        name: "Resource 1",
        appName: "resource-1",
        type: "compose",
        composeType: "compose",
      } as never,
      false,
    );

    expect(removeResourceCompose).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "resource-1",
      "resource-1",
      "compose",
      false,
    );
  });

  test("uses the typed owned-service removal for preview cleanup", async () => {
    const removeResourceService = mock(async () => {});
    const broker = {
      removeResourceService,
    } as unknown as DockerResourceCommandBrokerPort;
    const service = new DockerService({} as never, {}, broker);

    await service.removeServiceByName("preview-resource-1", "resource-1");

    expect(removeResourceService).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "resource-1",
      "preview-resource-1",
    );
  });

  test("uses the typed broker for local revision promotion", async () => {
    const promoteResourceServiceRevision = mock(async () => {});
    const broker = {
      promoteResourceServiceRevision,
    } as unknown as DockerResourceCommandBrokerPort;
    const service = new DockerService({} as never, {}, broker);

    await service.promoteServiceRevision(
      {
        id: "resource-1",
        type: "application",
        appName: "resource-1",
        name: "Application",
      } as never,
      "resource-1-revision",
    );

    expect(promoteResourceServiceRevision).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "resource-1",
      "resource-1",
      "resource-1-revision",
    );
  });

  test("uses the typed broker for local autoscaling", async () => {
    const scaleResourceService = mock(async () => {});
    const broker = {
      scaleResourceService,
    } as unknown as DockerResourceCommandBrokerPort;
    const service = new DockerService({} as never, {}, broker);

    await service.scaleService(
      {
        id: "resource-1",
        type: "application",
        appName: "resource-1",
        name: "Application",
      } as never,
      4,
    );

    expect(scaleResourceService).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "resource-1",
      "resource-1",
      4,
    );
  });

  test("rejects unowned preview service removal without broker delegation", async () => {
    const remove = mock(async () => {});
    const service = new DockerService(
      {
        getService: () => ({
          inspect: async () => ({
            Spec: { Labels: { "com.upstand.resource-id": "other-resource" } },
          }),
          remove,
        }),
      } as never,
      { DOCKER_NETWORK: "local" },
      undefined,
    );

    await expect(
      service.removeServiceByName("preview-resource-1", "resource-1"),
    ).rejects.toThrow("does not belong");
    expect(remove).not.toHaveBeenCalled();
  });

  test("uses the typed broker for a secret-free local Dockerfile build", async () => {
    const buildResourceDockerfile = mock(async () => {});
    const broker = {
      buildResourceDockerfile,
      execContainerCommand: mock(),
      execResourceServiceCommand: mock(),
    } as unknown as DockerResourceCommandBrokerPort;
    const service = new DockerService({} as never, {}, broker) as unknown as {
      buildDockerfileImage: (
        resourceId: string,
        clonePath: string,
        imageName: string,
        config: unknown,
        buildEnvVars: Record<string, string>,
        onLog: (message: string) => void,
        buildSecrets: Record<string, string>,
        preserveForRollback: boolean,
      ) => Promise<void>;
    };
    const contextPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "upstand-build-"),
    );
    const dockerfilePath = path.join(contextPath, "Dockerfile");
    fs.writeFileSync(dockerfilePath, "FROM alpine:3.20\n");
    try {
      await service.buildDockerfileImage(
        "resource-1",
        contextPath,
        "upstand-app-resource-1:latest",
        {
          dockerfilePath: "Dockerfile",
          dockerContextPath: ".",
          dockerNoCache: true,
          dockerBuildStage: "production",
          dockerBuildArgs: { BUILD_MODE: "production" },
          dockerCleanupCache: false,
        },
        { BUILD_VARIANT: "stable" },
        () => {},
        {},
        true,
      );
    } finally {
      fs.rmSync(contextPath, { recursive: true, force: true });
    }
    expect(buildResourceDockerfile).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "resource-1",
      "upstand-app-resource-1:latest",
      contextPath,
      dockerfilePath,
      expect.objectContaining({
        noCache: true,
        target: "production",
        buildArgs: {
          BUILD_MODE: "production",
          BUILD_VARIANT: "stable",
        },
        preserveForRollback: true,
      }),
    );
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
