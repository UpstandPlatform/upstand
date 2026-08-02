import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { DockerCleanupService } from "./docker-cleanup.service";
import { DockerReadOnlyService } from "./docker-readonly.service";

describe("Docker explorer image controls", () => {
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
});
