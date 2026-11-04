import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type {
  DockerInspectionBrokerPort,
  DockerResourceCommandBrokerPort,
  DockerResourceFileBrokerPort,
} from "./docker-broker-client";
import { DockerCleanupService } from "./docker-cleanup.service";
import { DockerReadOnlyService } from "./docker-readonly.service";

describe("Docker explorer image controls", () => {
  test("collects remote topology with one SSH session and parses each inventory", async () => {
    const service = Object.create(
      DockerReadOnlyService.prototype,
    ) as DockerReadOnlyService;
    let commandCount = 0;
    let remoteCommand = "";
    Object.assign(service, {
      executeRemote: async (_target: unknown, command: string) => {
        commandCount += 1;
        remoteCommand = command;
        return [
          `\0containers\n${JSON.stringify({
            ID: "container-1",
            Names: "web",
            Image: "nginx:1.27",
            State: "running",
            Status: "Up",
            Ports: "8080->80/tcp",
            Mounts: "app-data:/var/lib/app",
            Networks: "app-net",
            Labels: "com.upstand.resource-id=resource-1",
          })}\n`,
          "\0containers_status_0\n",
          `\0networks\n${JSON.stringify({
            ID: "network-1",
            Name: "app-net",
            Driver: "overlay",
            Scope: "swarm",
          })}\n`,
          "\0networks_status_0\n",
          `\0volumes\n${JSON.stringify({
            Name: "app-data",
            Driver: "local",
          })}\n`,
          "\0volumes_status_0\n",
          `\0swarm_nodes\n${JSON.stringify({
            ID: "node-1",
            Hostname: "manager-1",
            Addr: "10.0.0.10",
            ManagerStatus: "Leader",
            Status: "Ready",
            Self: "true",
          })}\n`,
          "\0swarm_nodes_status_0\n",
        ].join("");
      },
    });

    const snapshot = await service.getTopologySnapshot(
      {
        kind: "remote",
        name: "Production",
        host: "10.0.0.10",
        port: 22,
        username: "upstand",
      },
      { includeSwarmNodes: true },
    );

    expect(commandCount).toBe(1);
    expect(
      remoteCommand.match(/docker (?:ps|network ls|volume ls|node ls)/g),
    ).toHaveLength(4);
    expect(snapshot).toEqual({
      containers: [
        {
          id: "container-1",
          name: "web",
          image: "nginx:1.27",
          state: "running",
          status: "Up",
          ports: "8080->80/tcp",
          mounts: ["app-data:/var/lib/app"],
          networks: ["app-net"],
          labels: ["com.upstand.resource-id=resource-1"],
          createdAt: null,
        },
      ],
      networks: [
        {
          id: "network-1",
          name: "app-net",
          driver: "overlay",
          scope: "swarm",
          internal: false,
          attachable: false,
        },
      ],
      volumes: [{ name: "app-data", driver: "local", mountpoint: "" }],
      swarmNodes: [
        {
          id: "node-1",
          hostname: "manager-1",
          ip: "10.0.0.10",
          isLeader: true,
          role: "manager",
          status: "Ready",
          isLocalNode: true,
        },
      ],
    });
  });

  test("uses one typed broker request for the local topology snapshot", async () => {
    const snapshot = {
      containers: [],
      networks: [],
      volumes: [],
      swarmNodes: null,
    };
    const getTopologySnapshot = mock(() => Promise.resolve(snapshot));
    const service = new DockerReadOnlyService(
      {} as never,
      { getTopologySnapshot } as never,
    );

    await expect(
      service.getTopologySnapshot(
        { kind: "local", name: "Local Docker" },
        { includeSwarmNodes: false },
      ),
    ).resolves.toEqual(snapshot);

    expect(getTopologySnapshot).toHaveBeenCalledTimes(1);
    expect(getTopologySnapshot).toHaveBeenCalledWith(
      { kind: "local", name: "Local Docker" },
      { includeSwarmNodes: false },
    );
  });

  test("reports failed remote inventory sections while keeping successful data", async () => {
    const service = Object.create(
      DockerReadOnlyService.prototype,
    ) as DockerReadOnlyService;
    Object.assign(service, {
      executeRemote: async () =>
        [
          "\0containers\n\0containers_status_0\n",
          "\0networks\n\0networks_status_1\n",
          "\0volumes\n\0volumes_status_0\n",
        ].join(""),
    });

    const snapshot = await service.getTopologySnapshot({
      kind: "remote",
      name: "Production",
      host: "10.0.0.10",
      port: 22,
      username: "upstand",
    });

    expect(snapshot).toEqual({
      containers: [],
      networks: null,
      volumes: [],
      swarmNodes: null,
      errors: ["networks"],
    });
  });

  test("returns only named-volume mount metadata from local inspection", async () => {
    const service = new DockerReadOnlyService({
      getContainer: () => ({
        inspect: mock(() =>
          Promise.resolve({
            Mounts: [
              {
                Type: "volume",
                Name: "app-data",
                Destination: "/var/lib/app",
                RW: true,
              },
              {
                Type: "bind",
                Source: "/host/etc",
                Destination: "/etc/app",
                RW: true,
              },
              {
                Type: "volume",
                Name: "readonly-data",
                Destination: "/var/lib/readonly",
                RW: false,
              },
            ],
          }),
        ),
      }),
    } as never);

    await expect(
      service.getContainerMounts(
        { kind: "local", name: "test" },
        "container-1",
        "resource-1",
      ),
    ).resolves.toEqual([
      {
        type: "volume",
        name: "app-data",
        destination: "/var/lib/app",
        readOnly: false,
      },
      {
        type: "volume",
        name: "readonly-data",
        destination: "/var/lib/readonly",
        readOnly: true,
      },
    ]);
  });

  test("filters local container logs by text and level", async () => {
    const service = new DockerReadOnlyService({
      getContainer: () => ({
        logs: mock(() =>
          Promise.resolve(
            Buffer.from(
              "2026-01-01T00:00:00Z [info] booting\n2026-01-01T00:00:01Z [error] failed",
            ),
          ),
        ),
      }),
    } as never);

    const logs = await service.getLogs(
      { kind: "local", name: "test" },
      { containerId: "container-1", tail: 100, levels: ["error"] },
    );

    expect(logs).toBe("2026-01-01T00:00:01Z [error] failed");
  });

  test("force-removes a validated image reference", async () => {
    const remove = mock(() => Promise.resolve());
    const service = new DockerReadOnlyService({
      getImage: () => ({ remove }),
    } as never);

    await service.controlResource(
      { kind: "local", name: "test" },
      "ghcr.io/upstand/app:latest",
      "remove-image",
    );

    expect(remove).toHaveBeenCalledWith({ force: true });
  });

  test("rejects shell-like image references before touching Docker", async () => {
    const getImage = mock(() => ({ remove: mock(() => Promise.resolve()) }));
    const service = new DockerReadOnlyService({ getImage } as never);

    await expect(
      service.controlResource(
        { kind: "local", name: "test" },
        "nginx:latest; rm -rf /",
        "remove-image",
      ),
    ).rejects.toThrow("unsupported characters");
    expect(getImage).not.toHaveBeenCalled();
  });

  test("uploads a tar archive to a validated local container path", async () => {
    const putArchive = mock(() => Promise.resolve());
    const service = new DockerReadOnlyService({
      getContainer: () => ({ putArchive }),
    } as never);

    const result = await service.uploadArchiveToContainer(
      { kind: "local", name: "test" },
      "container-1",
      Buffer.from("tar-data"),
      "/tmp/uploads",
    );

    expect(result.destination).toBe("/tmp/uploads");
    expect(putArchive).toHaveBeenCalledWith(Buffer.from("tar-data"), {
      path: "/tmp/uploads",
    });
  });

  test("rejects unsafe container upload destinations", async () => {
    const getContainer = mock(() => ({ putArchive: mock() }));
    const service = new DockerReadOnlyService({ getContainer } as never);

    await expect(
      service.uploadArchiveToContainer(
        { kind: "local", name: "test" },
        "container-1",
        Buffer.from("tar-data"),
        "/tmp/../etc",
      ),
    ).rejects.toThrow("safe absolute path");
    expect(getContainer).not.toHaveBeenCalled();
  });

  test("bounds local container command output and settles the stream once", async () => {
    const stream = new EventEmitter() as EventEmitter & {
      destroy: ReturnType<typeof mock>;
    };
    stream.destroy = mock();
    const inspect = mock(() => Promise.resolve({ ExitCode: 0 }));
    const exec = {
      start: mock(() => Promise.resolve(stream)),
      inspect,
    };
    const getContainer = mock(() => ({
      exec: mock(() => Promise.resolve(exec)),
    }));
    const service = new DockerReadOnlyService({ getContainer } as never);

    const command = service.execContainerCommand(
      { kind: "local", name: "test" },
      "container-1",
      "printf output",
      { timeoutSeconds: 1 },
    );
    await Promise.resolve();
    await Promise.resolve();
    stream.emit("data", Buffer.alloc(50 * 1024 * 1024 + 1));

    await expect(command).rejects.toThrow("output exceeded");
    expect(stream.destroy).toHaveBeenCalledTimes(1);
    expect(inspect).not.toHaveBeenCalled();
  });

  test("normalizes local container CPU, memory, network, block, and PID stats", async () => {
    const service = new DockerReadOnlyService({
      getContainer: () => ({
        stats: mock(() =>
          Promise.resolve({
            cpu_stats: {
              cpu_usage: { total_usage: 250, percpu_usage: [1, 2] },
              system_cpu_usage: 2_000,
              online_cpus: 2,
            },
            precpu_stats: {
              cpu_usage: { total_usage: 100 },
              system_cpu_usage: 1_000,
            },
            memory_stats: { usage: 50, limit: 100 },
            networks: { eth0: { rx_bytes: 10, tx_bytes: 20 } },
            blkio_stats: {
              io_service_bytes_recursive: [
                { op: "Read", value: 30 },
                { op: "Write", value: 40 },
              ],
            },
            pids_stats: { current: 3 },
          }),
        ),
      }),
    } as never);

    await expect(
      service.getContainerStats({ kind: "local", name: "test" }, "container-1"),
    ).resolves.toEqual({
      containerId: "container-1",
      cpuPercent: 30,
      memoryUsageBytes: 50,
      memoryLimitBytes: 100,
      memoryPercent: 50,
      networkRxBytes: 10,
      networkTxBytes: 20,
      blockReadBytes: 30,
      blockWriteBytes: 40,
      pids: 3,
    });
  });

  test("prunes local docker resources via DockerCleanupService", async () => {
    const originalRun = DockerCleanupService.prototype.run;
    const runMock = mock(() =>
      Promise.resolve({
        action: "images" as const,
        output: ["images pruned local"],
      }),
    );
    DockerCleanupService.prototype.run = runMock;

    try {
      const service = new DockerReadOnlyService({} as never);
      const result = await service.prune(
        { kind: "local", name: "Local Docker" },
        "images",
      );

      expect(result.success).toBeTrue();
      expect(result.output).toEqual(["images pruned local"]);
      expect(runMock).toHaveBeenCalledWith("images");
    } finally {
      DockerCleanupService.prototype.run = originalRun;
    }
  });

  test("prunes remote docker resources via executeRemote", async () => {
    const service = new DockerReadOnlyService({} as never);
    const executedCommands: string[] = [];
    // biome-ignore lint/complexity/useLiteralKeys: The private transport is intentionally replaced in this unit test.
    service["executeRemote"] = mock(async (_target, cmd) => {
      executedCommands.push(cmd);
      return `${cmd} success`;
    });

    const result = await service.prune(
      {
        kind: "remote",
        name: "Remote Server",
        host: "192.168.1.1",
        port: 22,
        username: "root",
        privateKey: "key",
      },
      "all",
    );

    expect(result.success).toBeTrue();
    expect(result.output).toEqual([
      "containers: docker container prune --force success",
      "images: docker image prune --all --force --filter 'label!=com.upstand.rollback.keep=true' success",
      "volumes: docker volume prune --all --force success",
      "builder: docker builder prune --all --force success",
      "system: docker system prune --all --force --filter 'label!=com.upstand.rollback.keep=true' success",
    ]);
    expect(executedCommands).toEqual([
      "docker container prune --force",
      "docker image prune --all --force --filter 'label!=com.upstand.rollback.keep=true'",
      "docker volume prune --all --force",
      "docker builder prune --all --force",
      "docker system prune --all --force --filter 'label!=com.upstand.rollback.keep=true'",
    ]);
  });

  test("uses the typed broker for local inventory and resource control", async () => {
    const listContainers = mock(() =>
      Promise.resolve([
        {
          id: "container-1",
          name: "upstand_server",
          image: "upstand-server@sha256:abc",
          state: "running",
          status: "Up",
          ports: "",
          mounts: [],
          networks: ["upstand-network"],
          labels: ["com.upstand.managed=true"],
          createdAt: null,
        },
      ]),
    );
    const controlResource = mock(() =>
      Promise.resolve({ success: true as const }),
    );
    const broker = {
      listContainers,
      controlResource,
    } as unknown as DockerInspectionBrokerPort;
    const service = new DockerReadOnlyService({} as never, broker);

    await expect(
      service.listContainers({ kind: "local", name: "Local Docker" }),
    ).resolves.toEqual([
      expect.objectContaining({ id: "container-1", name: "upstand_server" }),
    ]);
    await service.controlResource(
      { kind: "local", name: "Local Docker" },
      "upstand-network",
      "remove-network",
    );

    expect(listContainers).toHaveBeenCalledTimes(1);
    expect(controlResource).toHaveBeenCalledWith(
      { kind: "local", name: "Local Docker" },
      "upstand-network",
      "remove-network",
    );
  });

  test("uses the resource-scoped typed broker for local file operations", async () => {
    const readFile = mock(() => Promise.resolve({ content: "aGk=" }));
    const resourceFileBroker = {
      readFile,
    } as unknown as DockerResourceFileBrokerPort;
    const service = new DockerReadOnlyService(
      {} as never,
      undefined,
      resourceFileBroker,
    );

    await expect(
      service.readFile(
        { kind: "local", name: "Local Docker" },
        "container-1",
        "/data",
        "/config.txt",
        "base64",
        "resource-1",
      ),
    ).resolves.toEqual({ content: "aGk=" });
    expect(readFile).toHaveBeenCalledWith(
      { kind: "local", name: "Local Docker" },
      "container-1",
      "/data",
      "/config.txt",
      "base64",
      "resource-1",
    );
  });

  test("uses the resource-scoped typed broker for local container commands", async () => {
    const execContainerCommand = mock(() =>
      Promise.resolve({ output: "ok", exitCode: 0 }),
    );
    const resourceCommandBroker = {
      execContainerCommand,
    } as unknown as DockerResourceCommandBrokerPort;
    const service = new DockerReadOnlyService(
      {} as never,
      undefined,
      undefined,
      resourceCommandBroker,
    );

    await expect(
      service.execContainerCommand(
        { kind: "local", name: "Local Docker" },
        "container-1",
        "printf ok",
        undefined,
        "resource-1",
      ),
    ).resolves.toEqual({ output: "ok", exitCode: 0 });
    expect(execContainerCommand).toHaveBeenCalledWith(
      { kind: "local", name: "Local Docker" },
      "container-1",
      "printf ok",
      undefined,
      "resource-1",
    );
  });
});
