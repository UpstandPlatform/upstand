import { describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import yaml from "yaml";
import {
  applyComposePlacementConstraints,
  DockerService,
  getComposeCliEnvironment,
  redactCommandOutput,
  shouldSuppressComposeRestart,
} from "./docker.service";
import type { DockerResourceCommandBrokerPort } from "./docker-broker-client";

describe("deployment command log safety", () => {
  test("uses typed bounded Swarm info instead of raw worker daemon info", async () => {
    const getSwarmInfo = mock(async () => ({
      localNodeState: "active",
      controlAvailable: true,
      nodeId: "manager-1",
      nodeAddress: "10.0.0.1",
      nodeCount: 1,
    }));
    const docker = {
      info: mock(() => {
        throw new Error("raw daemon info must not be used");
      }),
    };
    const service = new DockerService(docker as never, {}, {
      getSwarmInfo,
    } as unknown as DockerResourceCommandBrokerPort);

    await expect(service.getInfo()).resolves.toEqual({
      localNodeState: "active",
      controlAvailable: true,
      nodeId: "manager-1",
      nodeAddress: "10.0.0.1",
      nodeCount: 1,
    });
    await expect(
      service.initializeSwarm(docker as never),
    ).resolves.toBeUndefined();
    expect(getSwarmInfo).toHaveBeenCalledTimes(2);
    expect(docker.info).not.toHaveBeenCalled();
  });

  test("does not let build variables redirect Docker transport", () => {
    const service = new DockerService(
      {} as never,
      { DOCKER_CUSTOM_HEADERS: "X-Test=preserved" },
      undefined,
    ) as unknown as {
      getBuildEnvironment: (
        envVars: Record<string, string>,
        resourceId: string,
      ) => NodeJS.ProcessEnv;
    };

    const buildEnvironment = service.getBuildEnvironment(
      {
        DATABASE_URL: "postgres://build-value",
        DOCKER_HOST: "tcp://attacker.example:2375",
        DOCKER_CERT_PATH: "C:\\attacker-certs",
        DOCKER_CUSTOM_HEADERS: "X-Upstand-Resource-ID=other-resource",
        docker_host: "tcp://lowercase-attacker.example:2375",
      },
      "resource-1",
    );

    expect(buildEnvironment.DATABASE_URL).toBe("postgres://build-value");
    expect(buildEnvironment.DOCKER_HOST).not.toBe(
      "tcp://attacker.example:2375",
    );
    expect(buildEnvironment.DOCKER_CERT_PATH).not.toBe("C:\\attacker-certs");
    expect(buildEnvironment.docker_host).toBeUndefined();
    expect(buildEnvironment.DOCKER_CUSTOM_HEADERS).toContain(
      "X-Upstand-Resource-ID=resource-1",
    );
    expect(buildEnvironment.DOCKER_CUSTOM_HEADERS).not.toContain(
      "other-resource",
    );
  });

  test("rejects malformed or unbounded build environments before subprocesses", () => {
    const service = new DockerService(
      {} as never,
      { DOCKER_HOST: "ssh://builder" },
      undefined,
    ) as unknown as {
      getBuildEnvironment: (
        envVars: Record<string, string>,
        resourceId: string,
      ) => NodeJS.ProcessEnv;
    };

    expect(() =>
      service.getBuildEnvironment({ "BAD-NAME": "value" }, "resource-1"),
    ).toThrow("has an invalid name or value");
    expect(() =>
      service.getBuildEnvironment({ VALID_NAME: "value\u0000" }, "resource-1"),
    ).toThrow("has an invalid name or value");
    expect(() =>
      service.getBuildEnvironment(
        { VALID_NAME: "x".repeat(16 * 1024 + 1) },
        "resource-1",
      ),
    ).toThrow("has an invalid name or value");
    expect(() =>
      service.getBuildEnvironment(
        Object.fromEntries(
          Array.from({ length: 33 }, (_, index) => [
            `SECRET_${index}`,
            "x".repeat(16 * 1024),
          ]),
        ),
        "resource-1",
      ),
    ).toThrow("aggregate size limit");
  });

  test("bounds the Compose subprocess environment after filtering Docker controls", () => {
    expect(
      getComposeCliEnvironment({
        DOCKER_HOST: "tcp://attacker.example:2375",
        VALID_NAME: "value",
      }),
    ).toEqual({ VALID_NAME: "value" });
    expect(() => getComposeCliEnvironment({ "BAD-NAME": "value" })).toThrow(
      "has an invalid name or value",
    );
    expect(() =>
      getComposeCliEnvironment({ VALID_NAME: "value\u0000" }),
    ).toThrow("has an invalid name or value");
    expect(() =>
      getComposeCliEnvironment({
        VALID_NAME: "x".repeat(16 * 1024 + 1),
      }),
    ).toThrow("has an invalid name or value");
    expect(() =>
      getComposeCliEnvironment(
        Object.fromEntries(
          Array.from({ length: 33 }, (_, index) => [
            `VARIABLE_${index}`,
            "x".repeat(16 * 1024),
          ]),
        ),
      ),
    ).toThrow("aggregate size limit");
  });

  test("preserves the authenticated local broker transport for CLI subprocesses", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "upstand-broker-cli-"),
    );
    const tokenFile = path.join(directory, "broker-token");
    const previous = {
      DOCKER_HOST: process.env.DOCKER_HOST,
      DOCKER_TLS_VERIFY: process.env.DOCKER_TLS_VERIFY,
      DOCKER_CERT_PATH: process.env.DOCKER_CERT_PATH,
      UPSTAND_DOCKER_BROKER_TOKEN_FILE:
        process.env.UPSTAND_DOCKER_BROKER_TOKEN_FILE,
      UPSTAND_DOCKER_BROKER_CALLER: process.env.UPSTAND_DOCKER_BROKER_CALLER,
      DOCKER_CUSTOM_HEADERS: process.env.DOCKER_CUSTOM_HEADERS,
    };
    process.env.DOCKER_HOST = "https://docker-broker:2375";
    process.env.DOCKER_TLS_VERIFY = "1";
    process.env.DOCKER_CERT_PATH = "/run/secrets";
    process.env.UPSTAND_DOCKER_BROKER_TOKEN_FILE = tokenFile;
    process.env.UPSTAND_DOCKER_BROKER_CALLER = "server";
    process.env.DOCKER_CUSTOM_HEADERS =
      "X-Test=preserved,X-Upstand-Resource-ID=stale";
    fs.writeFileSync(tokenFile, "b".repeat(64), { mode: 0o600 });

    try {
      const service = new DockerService(
        {} as never,
        {},
        {} as unknown as DockerResourceCommandBrokerPort,
      ) as unknown as {
        getDockerCommandEnvironment: (
          resourceId: string,
        ) => Record<string, string | undefined>;
      };
      const environment = service.getDockerCommandEnvironment("resource-1");

      expect(environment.DOCKER_HOST).toBe("https://docker-broker:2375");
      expect(environment.DOCKER_TLS_VERIFY).toBe("1");
      expect(environment.DOCKER_CERT_PATH).toBe("/run/secrets");
      expect(environment.DOCKER_CUSTOM_HEADERS).toContain(
        `X-Upstand-Docker-Broker-Token=${"b".repeat(64)}`,
      );
      expect(environment.DOCKER_CUSTOM_HEADERS).toContain(
        "X-Upstand-Docker-Caller=server",
      );
      expect(environment.DOCKER_CUSTOM_HEADERS).toContain(
        "X-Upstand-Resource-ID=resource-1",
      );
      expect(environment.DOCKER_CUSTOM_HEADERS).not.toContain("stale");
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("fails closed when the deployment worker has no Docker broker", async () => {
    const previous = {
      DOCKER_HOST: process.env.DOCKER_HOST,
      UPSTAND_DOCKER_BROKER_CALLER: process.env.UPSTAND_DOCKER_BROKER_CALLER,
    };
    delete process.env.DOCKER_HOST;
    process.env.UPSTAND_DOCKER_BROKER_CALLER = "deployment-worker";

    try {
      const service = new DockerService({} as never, {}, undefined);

      await expect(
        service.deployComposeStack(
          {
            id: "resource-1",
            name: "Resource 1",
            appName: "resource-1",
            type: "compose",
            composeType: "compose",
            advancedConfig: "{}",
            envVars: null,
          } as never,
          "services:\n  app:\n    image: alpine:3.20\n",
          () => {},
        ),
      ).rejects.toThrow(
        "Deployment-worker Compose orchestration requires the authenticated Docker broker",
      );
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test("does not inherit control-plane secrets into isolated command environments", async () => {
    const key = `UPSTAND_TEST_CONTROL_PLANE_SECRET_${process.pid}`;
    const sentinel = "control-plane-secret";
    const previous = process.env[key];
    process.env[key] = sentinel;

    try {
      const service = new DockerService({} as never) as unknown as {
        runCommandAsync: (
          command: string,
          args: string[],
          onLog: (log: string) => void,
          env?: NodeJS.ProcessEnv,
          options?: { inheritEnvironment?: boolean },
        ) => Promise<void>;
      };
      let output = "";
      await service.runCommandAsync(
        process.execPath,
        ["-e", `process.stdout.write(process.env.${key} ?? "")`],
        (log) => {
          output += log;
        },
        {},
        { inheritEnvironment: false },
      );
      expect(output).toBe("");
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  test("terminates commands that exceed the bounded streamed output limit", async () => {
    const service = new DockerService({} as never) as unknown as {
      runCommandAsync: (
        command: string,
        args: string[],
        onLog: (log: string) => void,
        env?: NodeJS.ProcessEnv,
        options?: { maxOutputBytes?: number },
      ) => Promise<void>;
    };
    const output: string[] = [];

    await expect(
      service.runCommandAsync(
        process.execPath,
        ["-e", "process.stdout.write('x'.repeat(4096))"],
        (log) => output.push(log),
        undefined,
        { maxOutputBytes: 1_024 },
      ),
    ).rejects.toThrow("output exceeded the 1024-byte limit");
    expect(output.join("")).toContain("output exceeded the 1024-byte limit");
    expect(output.join("")).not.toContain("x".repeat(1_024));
  });

  test("fails closed when placement constraints cannot be applied", () => {
    expect(() =>
      applyComposePlacementConstraints("services:\n  web: invalid", [
        "node.labels.upstand.role == worker",
      ]),
    ).toThrow("Compose service 'web' is invalid");

    const updated = applyComposePlacementConstraints(
      "services:\n  web:\n    image: example/web\n    deploy:\n      placement:\n        constraints:\n          - node.labels.existing == true\n",
      ["node.labels.upstand.role == worker", "node.labels.existing == true"],
    );
    const parsed = yaml.parse(updated) as {
      services: {
        web: { deploy: { placement: { constraints: string[] } } };
      };
    };
    expect(parsed.services.web.deploy.placement.constraints).toEqual([
      "node.labels.existing == true",
      "node.labels.upstand.role == worker",
    ]);
  });

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
        resourceId?: string,
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

    await service.markImageForRollback(
      "upstand-app-resource:latest",
      () => {},
      "resource-1",
    );

    const createArgs = calls[0]?.args;
    const commitArgs = calls[1]?.args;
    const markerImage = commitArgs?.[4];
    const containerName = createArgs?.[2];
    if (typeof markerImage !== "string" || typeof containerName !== "string") {
      throw new Error("Rollback marker command was not recorded");
    }
    expect(markerImage.split(":")).toHaveLength(2);
    expect(createArgs).toEqual([
      "create",
      "--name",
      containerName,
      "--label",
      "com.upstand.resource-id=resource-1",
      "upstand-app-resource:latest",
    ]);
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

  test("uses the typed broker for local resource rollback markers", async () => {
    const markResourceImageForRollback = mock(async () => {});
    const service = new DockerService({} as never, {}, {
      markResourceImageForRollback,
    } as unknown as DockerResourceCommandBrokerPort) as unknown as {
      markImageForRollback: (
        imageName: string,
        onLog: (message: string) => void,
        resourceId?: string,
      ) => Promise<void>;
    };

    await service.markImageForRollback(
      "upstand-app-resource-1:latest",
      () => {},
      "resource-1",
    );

    expect(markResourceImageForRollback).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "resource-1",
      "upstand-app-resource-1:latest",
    );
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
    const pullResourceImage = mock(async () => {});
    const pull = mock(async () => "pull-stream" as never);
    const upsertResourceService = mock(async () => {});
    const ensureResourceServiceNetwork = mock(async () => {});
    const broker = {
      pullResourceImage,
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
      pull,
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

    expect(pullResourceImage).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "resource-1",
      "example/app:latest",
      {
        username: "builder",
        password: "temporary",
        serveraddress: "registry.example",
      },
    );
    expect(pull).not.toHaveBeenCalled();
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

  test("does not deploy a stale local image when the required pull fails", async () => {
    const pullResourceImage = mock(async () => {
      throw new Error("registry unavailable");
    });
    const upsertResourceService = mock(async () => {});
    const ensureResourceServiceNetwork = mock(async () => {});
    const broker = {
      pullResourceImage,
      upsertResourceService,
      ensureResourceServiceNetwork,
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
    } as never;
    const service = new DockerService(docker, {}, broker);
    const logs: string[] = [];

    await expect(
      service.deployAppImage(
        {
          id: "resource-1",
          name: "Resource 1",
          appName: "resource-1",
          dockerImage: "example/app:latest",
          advancedConfig: "{}",
        } as never,
        {},
        (message) => logs.push(message),
      ),
    ).rejects.toThrow("Failed to pull image: registry unavailable");
    expect(upsertResourceService).not.toHaveBeenCalled();
    expect(logs).toContain("Failed to pull image: registry unavailable\n");
  });

  test("uses the typed owned-network ensure operation for isolated local deployments", async () => {
    const ensureResourceNetwork = mock(async () => ({
      id: "network-1",
      name: "upstand-resource-resource-1",
      created: true,
    }));
    const broker = {
      ensureResourceNetwork,
    } as unknown as DockerResourceCommandBrokerPort;
    const service = new DockerService({} as never, {}, broker) as unknown as {
      ensureDeploymentNetwork(resource: unknown): Promise<{
        id: string;
        name: string;
        created: boolean;
        isolated: boolean;
      }>;
    };

    await expect(
      service.ensureDeploymentNetwork({
        id: "resource-1",
        advancedConfig: JSON.stringify({ isolatedDeployment: true }),
      }),
    ).resolves.toEqual({
      id: "network-1",
      name: "upstand-resource-resource-1",
      created: true,
      isolated: true,
    });
    expect(ensureResourceNetwork).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "resource-1",
    );
  });

  test("pre-provisions Compose networks and volumes through the typed broker", async () => {
    const ensureUpstandNetwork = mock(async () => ({
      id: "shared-network-id",
      created: false,
    }));
    const ensureResourceNetwork = mock(async () => ({
      id: "private-network-id",
      name: "upstand-resource-resource-1-private",
      created: true,
    }));
    const ensureResourceVolume = mock(async () => {});
    const broker = {
      ensureUpstandNetwork,
      ensureResourceNetwork,
      ensureResourceVolume,
    } as unknown as DockerResourceCommandBrokerPort;
    const service = new DockerService({} as never, {}, broker) as unknown as {
      runCommandAsync: (
        command: string,
        args: string[],
        onLog: (log: string) => void,
        env?: NodeJS.ProcessEnv,
        options?: {
          resourceId?: string;
          redactions?: readonly string[];
          inheritEnvironment?: boolean;
        },
      ) => Promise<void>;
      waitForComposeConvergence: (
        projectName: string,
        resourceId: string,
        onLog: (log: string) => void,
      ) => Promise<void>;
      deployComposeStack: DockerService["deployComposeStack"];
    };
    let generatedCompose = "";
    let commandEnvironment: NodeJS.ProcessEnv | undefined;
    let commandOptions: { inheritEnvironment?: boolean } | undefined;
    service.runCommandAsync = async (_command, args, _onLog, env, options) => {
      commandEnvironment = env;
      commandOptions = options;
      const fileIndex = args.indexOf("--file");
      generatedCompose = fs.readFileSync(args[fileIndex + 1] || "", "utf8");
    };
    service.waitForComposeConvergence = async () => {};

    await service.deployComposeStack(
      {
        id: "resource-1",
        name: "Resource 1",
        appName: "resource-1",
        type: "compose",
        composeType: "compose",
        advancedConfig: "{}",
        envVars: null,
      } as never,
      `
services:
  api:
    image: nginx:alpine
    networks: [private]
    volumes: [data:/var/lib/data]
networks:
  private:
volumes:
  data:
`,
      () => {},
      undefined,
      {
        DATABASE_URL: "postgres://resource-value",
        DOCKER_HOST: "tcp://attacker.example:2375",
      },
    );

    const parsed = yaml.parse(generatedCompose) as {
      networks: Record<string, Record<string, unknown>>;
      volumes: Record<string, Record<string, unknown>>;
    };
    expect(ensureUpstandNetwork).toHaveBeenCalledTimes(1);
    expect(commandOptions?.inheritEnvironment).toBe(false);
    expect(commandEnvironment?.DATABASE_URL).toBe("postgres://resource-value");
    expect(commandEnvironment?.DOCKER_HOST).toBeUndefined();
    expect(ensureResourceNetwork).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "resource-1",
      {
        networkKey: "private",
        projectName: "resource-1",
        composeType: "compose",
        internal: false,
      },
    );
    expect(ensureResourceVolume).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "resource-1",
      "data",
      "resource-1",
      "compose",
    );
    expect(parsed.networks.private).toEqual({
      name: "upstand-resource-resource-1-private",
      external: true,
    });
    expect(parsed.volumes.data).toEqual({
      name: "upstand-resource-resource-1-volume-data",
      external: true,
    });
  });

  test("authenticates Compose and Stack deployments with an ephemeral registry config", async () => {
    const ensureUpstandNetwork = mock(async () => ({
      id: "shared-network-id",
      created: false,
    }));
    const ensureResourceNetwork = mock(async () => ({
      id: "private-network-id",
      name: "upstand-resource-resource-registry-private",
      created: true,
    }));
    const ensureResourceVolume = mock(async () => {});
    const broker = {
      ensureUpstandNetwork,
      ensureResourceNetwork,
      ensureResourceVolume,
    } as unknown as DockerResourceCommandBrokerPort;
    const service = new DockerService({} as never, {}, broker) as unknown as {
      runCommandAsync: (
        command: string,
        args: string[],
        onLog: (log: string) => void,
        env?: NodeJS.ProcessEnv,
        options?: {
          stdin?: string;
          resourceId?: string;
          redactions?: readonly string[];
          inheritEnvironment?: boolean;
        },
      ) => Promise<void>;
      waitForComposeConvergence: (
        projectName: string,
        resourceId: string,
        onLog: (log: string) => void,
      ) => Promise<void>;
      deployComposeStack: DockerService["deployComposeStack"];
    };
    const calls: Array<{
      args: string[];
      env?: NodeJS.ProcessEnv;
      options?: { stdin?: string; redactions?: readonly string[] };
    }> = [];
    let configPath = "";
    service.runCommandAsync = async (_command, args, _onLog, env, options) => {
      calls.push({ args, env, options });
      if (args.includes("--file")) {
        const fileIndex = args.indexOf("--file");
        expect(fs.existsSync(args[fileIndex + 1] || "")).toBe(true);
      }
      if (env?.DOCKER_CONFIG) configPath = env.DOCKER_CONFIG;
    };
    service.waitForComposeConvergence = async () => {};

    await service.deployComposeStack(
      {
        id: "resource-registry",
        name: "Private Stack",
        appName: "private-stack",
        type: "compose",
        composeType: "stack",
        advancedConfig: "{}",
        envVars: null,
      } as never,
      "services:\n  app:\n    image: registry.example.com/team/app:1\n",
      () => {},
      undefined,
      undefined,
      {
        username: "robot",
        password: "registry-password",
        serveraddress: "registry.example.com",
      },
    );

    expect(calls).toHaveLength(3);
    expect(calls[0]?.args).toEqual([
      "login",
      "--username",
      "robot",
      "--password-stdin",
      "registry.example.com",
    ]);
    expect(calls[0]?.options?.stdin).toBe("registry-password\n");
    expect(calls[1]?.args).toContain("--with-registry-auth");
    expect(calls[2]?.args).toEqual(["logout", "registry.example.com"]);
    expect(calls[1]?.env?.DOCKER_CONFIG).toBe(configPath);
    expect(configPath).not.toBe("");
    expect(fs.existsSync(configPath)).toBe(false);
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

  test("keeps generated Compose manifests private until cleanup", async () => {
    const resourceId = `compose-private-${process.pid}-${Date.now()}`;
    const service = new DockerService({} as never) as unknown as {
      ensureDeploymentNetwork: (
        resource: unknown,
      ) => Promise<{ id: string; name: string; isolated: boolean }>;
      runCommandAsync: (
        command: string,
        args: string[],
        onLog: (log: string) => void,
        env?: NodeJS.ProcessEnv,
        options?: { resourceId?: string; redactions?: readonly string[] },
      ) => Promise<void>;
      waitForComposeConvergence: (
        projectName: string,
        resourceId: string,
        onLog: (log: string) => void,
      ) => Promise<void>;
      deployComposeStack: DockerService["deployComposeStack"];
    };
    let composePath = "";
    service.ensureDeploymentNetwork = async () => ({
      id: "network-1",
      name: "upstand-network",
      isolated: false,
    });
    service.waitForComposeConvergence = async () => {};
    service.runCommandAsync = async (_command, args) => {
      const fileIndex = args.indexOf("--file");
      composePath = args[fileIndex + 1] || "";
      expect(composePath).not.toBe("");
      expect(fs.readFileSync(composePath, "utf8")).toContain("super-secret");
      if (process.platform !== "win32") {
        expect(fs.statSync(composePath).mode & 0o077).toBe(0);
      }
    };

    await service.deployComposeStack(
      {
        id: resourceId,
        name: "Private Compose",
        appName: resourceId,
        type: "compose",
        composeType: "compose",
        advancedConfig: "{}",
        envVars: null,
      } as never,
      "services:\n  app:\n    image: alpine:3.20\n    environment:\n      SECRET: super-secret\n",
      () => {},
    );

    expect(fs.existsSync(composePath)).toBe(false);
  });

  test("cleans the Compose workspace when manifest preparation fails", async () => {
    const resourceId = `compose-invalid-${process.pid}-${Date.now()}`;
    const service = new DockerService({} as never) as unknown as {
      ensureDeploymentNetwork: (
        resource: unknown,
      ) => Promise<{ id: string; name: string; isolated: boolean }>;
      deployComposeStack: DockerService["deployComposeStack"];
    };
    service.ensureDeploymentNetwork = async () => ({
      id: "network-1",
      name: "upstand-network",
      isolated: false,
    });

    await expect(
      service.deployComposeStack(
        {
          id: resourceId,
          name: "Invalid Compose",
          appName: resourceId,
          type: "compose",
          composeType: "compose",
          advancedConfig: "{}",
          envVars: null,
        } as never,
        "services: [",
        () => {},
      ),
    ).rejects.toThrow("Compose YAML is invalid");

    expect(fs.existsSync(path.join(process.cwd(), ".builds", resourceId))).toBe(
      false,
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
        {},
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
        },
        preserveForRollback: true,
      }),
    );
  });

  test("keeps resolved environment values out of Docker image history", async () => {
    const service = new DockerService(
      {} as never,
      { DOCKER_HOST: "ssh://builder" },
      null as never,
    ) as unknown as {
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
      runCommandAsync: (
        command: string,
        args: string[],
        onLog: (message: string) => void,
        env?: NodeJS.ProcessEnv,
        options?: { redactions?: string[]; resourceId?: string },
      ) => Promise<void>;
    };
    const calls: Array<{
      command: string;
      args: string[];
      env?: NodeJS.ProcessEnv;
    }> = [];
    service.runCommandAsync = async (command, args, _onLog, env) => {
      calls.push({ command, args, env });
    };
    const contextPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "upstand-secret-build-"),
    );
    fs.writeFileSync(
      path.join(contextPath, "Dockerfile"),
      "# syntax=docker/dockerfile:1\nFROM alpine:3.20\n",
    );
    try {
      await service.buildDockerfileImage(
        "resource-1",
        contextPath,
        "upstand-app-resource-1:latest",
        {
          dockerfilePath: "Dockerfile",
          dockerContextPath: ".",
          dockerNoCache: false,
          dockerBuildStage: undefined,
          dockerBuildArgs: { BUILD_MODE: "production" },
          dockerCleanupCache: false,
        },
        { NPM_TOKEN: "secret-value" },
        () => {},
        {},
        false,
      );
    } finally {
      fs.rmSync(contextPath, { recursive: true, force: true });
    }
    const buildCall = calls[0];
    expect(buildCall?.command).toBe("docker");
    expect(buildCall?.args).toEqual(
      expect.arrayContaining([
        "--build-arg",
        "BUILD_MODE=production",
        "--secret",
        "id=NPM_TOKEN,env=NPM_TOKEN",
      ]),
    );
    expect(buildCall?.args).not.toContain("NPM_TOKEN=secret-value");
    expect(buildCall?.env).toMatchObject({ NPM_TOKEN: "secret-value" });
  });

  test("rejects secret-like explicit Docker build arguments", async () => {
    const service = new DockerService(
      {} as never,
      { DOCKER_HOST: "ssh://builder" },
      null as never,
    ) as unknown as {
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
      path.join(os.tmpdir(), "upstand-invalid-build-"),
    );
    fs.writeFileSync(
      path.join(contextPath, "Dockerfile"),
      "FROM alpine:3.20\n",
    );
    try {
      await expect(
        service.buildDockerfileImage(
          "resource-1",
          contextPath,
          "upstand-app-resource-1:latest",
          {
            dockerfilePath: "Dockerfile",
            dockerContextPath: ".",
            dockerNoCache: false,
            dockerBuildStage: undefined,
            dockerBuildArgs: { NPM_TOKEN: "secret-value" },
            dockerCleanupCache: false,
          },
          {},
          () => {},
          {},
          false,
        ),
      ).rejects.toThrow("looks secret-like");
    } finally {
      fs.rmSync(contextPath, { recursive: true, force: true });
    }
  });

  test("rejects build secrets that target Docker control variables", async () => {
    const service = new DockerService(
      {} as never,
      { DOCKER_HOST: "ssh://builder" },
      null as never,
    ) as unknown as {
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
      path.join(os.tmpdir(), "upstand-control-secret-build-"),
    );
    fs.writeFileSync(
      path.join(contextPath, "Dockerfile"),
      "FROM alpine:3.20\n",
    );
    try {
      await expect(
        service.buildDockerfileImage(
          "resource-1",
          contextPath,
          "upstand-app-resource-1:latest",
          {
            dockerfilePath: "Dockerfile",
            dockerContextPath: ".",
            dockerNoCache: false,
            dockerBuildStage: undefined,
            dockerBuildArgs: {},
            dockerCleanupCache: false,
          },
          {},
          () => {},
          { DOCKER_HOST: "tcp://attacker.example:2375" },
          false,
        ),
      ).rejects.toThrow(
        "cannot override Docker or Compose control environment",
      );
    } finally {
      fs.rmSync(contextPath, { recursive: true, force: true });
    }
  });

  test("rejects malformed or unbounded Docker build secrets before execution", async () => {
    const service = new DockerService(
      {} as never,
      { DOCKER_HOST: "ssh://builder" },
      null as never,
    ) as unknown as {
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
      path.join(os.tmpdir(), "upstand-invalid-secret-build-"),
    );
    fs.writeFileSync(
      path.join(contextPath, "Dockerfile"),
      "FROM alpine:3.20\n",
    );
    const config = {
      dockerfilePath: "Dockerfile",
      dockerContextPath: ".",
      dockerNoCache: false,
      dockerBuildStage: undefined,
      dockerBuildArgs: {},
      dockerCleanupCache: false,
    };
    const build = (buildSecrets: Record<string, string>) =>
      service.buildDockerfileImage(
        "resource-1",
        contextPath,
        "upstand-app-resource-1:latest",
        config,
        {},
        () => {},
        buildSecrets,
        false,
      );

    try {
      await expect(build({ "BAD-NAME": "value" })).rejects.toThrow(
        "has an invalid name or value",
      );
      await expect(build({ VALID_NAME: "value\u0000" })).rejects.toThrow(
        "has an invalid name or value",
      );
      await expect(
        build({ VALID_NAME: "x".repeat(16 * 1024 + 1) }),
      ).rejects.toThrow("has an invalid name or value");
      await expect(
        build(
          Object.fromEntries(
            Array.from({ length: 65 }, (_, index) => [`SECRET_${index}`, "x"]),
          ),
        ),
      ).rejects.toThrow("exceed their limit");
      await expect(
        build({
          ...Object.fromEntries(
            Array.from({ length: 33 }, (_, index) => [
              `SECRET_${index}`,
              "x".repeat(16 * 1024),
            ]),
          ),
        }),
      ).rejects.toThrow("aggregate size limit");
    } finally {
      fs.rmSync(contextPath, { recursive: true, force: true });
    }
  });

  test("includes resource ownership labels on raw Dockerfile builds", async () => {
    const service = new DockerService(
      {} as never,
      { DOCKER_HOST: "ssh://builder" },
      null as never,
    ) as unknown as {
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
      runCommandAsync: (
        command: string,
        args: string[],
        onLog: (message: string) => void,
        env?: NodeJS.ProcessEnv,
        options?: { resourceId?: string },
      ) => Promise<void>;
    };
    const calls: Array<{ command: string; args: string[] }> = [];
    service.runCommandAsync = async (command, args) => {
      calls.push({ command, args });
    };
    const contextPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "upstand-raw-build-"),
    );
    fs.writeFileSync(
      path.join(contextPath, "Dockerfile"),
      "FROM alpine:3.20\n",
    );
    try {
      await service.buildDockerfileImage(
        "resource-1",
        contextPath,
        "upstand-app-resource-1:latest",
        {
          dockerfilePath: "Dockerfile",
          dockerContextPath: ".",
          dockerNoCache: false,
          dockerBuildStage: undefined,
          dockerBuildArgs: { BUILD_MODE: "production" },
          dockerCleanupCache: false,
        },
        { NPM_TOKEN: "secret-value" },
        () => {},
        {},
        false,
      );
    } finally {
      fs.rmSync(contextPath, { recursive: true, force: true });
    }
    expect(calls[0]).toEqual(
      expect.objectContaining({
        command: "docker",
        args: expect.arrayContaining([
          "--label",
          "com.upstand.resource-id=resource-1",
          "--build-arg",
          "BUILD_MODE=production",
          "--secret",
          "id=NPM_TOKEN,env=NPM_TOKEN",
        ]),
      }),
    );
    expect(calls[0]?.args).not.toContain("NPM_TOKEN=secret-value");
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

  test("uses the resource-scoped Docker client for Compose container discovery", async () => {
    const listContainers = mock(async () => [
      {
        Id: "container-1",
        Names: ["/resource-app-api"],
        State: "running",
        Ports: [],
      },
    ]);
    const scopedDocker = { listContainers };
    const baseDocker = {
      listContainers: mock(() => {
        throw new Error("unscoped Docker access must not be used");
      }),
    };
    const resourceScopedDockerFactory = mock(() => scopedDocker);
    const service = new DockerService(
      baseDocker as never,
      {},
      undefined,
      resourceScopedDockerFactory as never,
    );

    await expect(
      service.getContainers({
        id: "resource-1",
        name: "Resource 1",
        appName: "resource-app",
        type: "compose",
        composeType: "compose",
      } as never),
    ).resolves.toEqual([
      {
        id: "container-1",
        name: "resource-app-api",
        status: "running",
        ports: "N/A",
        node: "local",
      },
    ]);

    expect(resourceScopedDockerFactory).toHaveBeenCalledWith("resource-1");
    expect(listContainers).toHaveBeenCalledWith({
      all: true,
      filters: JSON.stringify({
        label: [
          "com.docker.compose.project=resource-app",
          "com.upstand.resource-id=resource-1",
        ],
      }),
    });
  });

  test("uses the resource-scoped Docker client for Swarm service control", async () => {
    const update = mock(async () => {});
    const scopedDocker = {
      getService: mock(() => ({
        inspect: async () => ({
          Version: { Index: 7 },
          Spec: {
            Mode: { Replicated: { Replicas: 0 } },
            TaskTemplate: { ContainerSpec: { Image: "example/app:1" } },
          },
        }),
        update,
      })),
    };
    const baseDocker = {
      getService: mock(() => {
        throw new Error("unscoped Docker access must not be used");
      }),
    };
    const resourceScopedDockerFactory = mock(() => scopedDocker);
    const service = new DockerService(
      baseDocker as never,
      {},
      undefined,
      resourceScopedDockerFactory as never,
    );

    await service.controlService(
      {
        id: "resource-1",
        name: "Resource 1",
        appName: "resource-app",
        type: "application",
      } as never,
      "start",
    );

    expect(resourceScopedDockerFactory).toHaveBeenCalledWith("resource-1");
    expect(update).toHaveBeenCalledWith({
      version: 7,
      Name: "resource-app",
      Mode: { Replicated: { Replicas: 1 } },
      TaskTemplate: { ContainerSpec: { Image: "example/app:1" } },
      EndpointSpec: undefined,
    });
  });

  test("uses typed ownership-checked teardown when stopping a local Swarm stack", async () => {
    const removeResourceCompose = mock(async () => {});
    const service = new DockerService({} as never, {}, {
      removeResourceCompose,
    } as unknown as DockerResourceCommandBrokerPort);

    await service.controlService(
      {
        id: "resource-1",
        name: "Resource 1",
        appName: "resource-app",
        type: "compose",
        composeType: "stack",
      } as never,
      "stop",
    );

    expect(removeResourceCompose).toHaveBeenCalledWith(
      { kind: "local", name: "local" },
      "resource-1",
      "resource-app",
      "stack",
      false,
    );
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
