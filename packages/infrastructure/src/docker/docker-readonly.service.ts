import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type {
  DockerContainer,
  DockerContainerCommand,
  DockerContainerStats,
  DockerExecPort,
  DockerImage,
  DockerInfo,
  DockerInspectionTarget,
  DockerLogRequest,
  DockerNetwork,
  DockerPruneOptions,
  DockerPruneType,
  DockerResourceCommand,
  DockerServiceSummary,
  DockerVolume,
} from "@upstand/usecases/ports/docker";
import {
  cleanDockerLogs,
  filterDockerLogs,
} from "@upstand/usecases/resource/docker-log-filter";
import type Docker from "dockerode";
import { Client } from "ssh2";
import { DockerCleanupService } from "./docker-cleanup.service";
import { getDockerInstance } from "./docker-client";

const execFileAsync = promisify(execFile);

const VOLUME_HELPER_IMAGE = "alpine:3.20";

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatPorts(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((port) => {
      const item = asRecord(port);
      const published = item.PublicPort ?? item.PublishedPort;
      const target = item.PrivatePort ?? item.TargetPort;
      return published && target ? `${published}:${target}` : "";
    })
    .filter(Boolean)
    .join(", ");
}

function parseJsonLines(output: string): Record<string, unknown>[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return asRecord(JSON.parse(line));
      } catch {
        return { raw: line };
      }
    });
}

function dockerInfo(raw: unknown): DockerInfo {
  const value = asRecord(raw);
  const swarm = asRecord(value.Swarm);
  return {
    name: asString(value.Name),
    serverVersion: asString(value.ServerVersion),
    operatingSystem: asString(value.OperatingSystem),
    architecture: asString(value.Architecture),
    containers: asNumber(value.Containers),
    images: asNumber(value.Images),
    memoryBytes: asNumber(value.MemTotal),
    swarmState: asString(swarm.LocalNodeState, "inactive"),
  };
}

export class DockerReadOnlyService implements DockerExecPort {
  constructor(private readonly docker: Docker = getDockerInstance()) {}

  async controlContainer(
    target: DockerInspectionTarget,
    containerId: string,
    command: DockerContainerCommand,
  ): Promise<{ success: true }> {
    assertIdentifier(containerId, "Container");
    if (target.kind === "local") {
      const container = this.docker.getContainer(containerId);
      if (command === "restart") await container.restart();
      if (command === "stop") await container.stop();
      if (command === "start") await container.start();
      if (command === "remove") await container.remove({ force: true });
    } else {
      const action = command === "remove" ? "rm --force" : command;
      const safeContainer = shellQuote(containerId);
      await this.executeRemote(
        target,
        `docker container ${action} ${safeContainer}`,
      );
    }
    return { success: true };
  }

  async controlResource(
    target: DockerInspectionTarget,
    resourceId: string,
    command: DockerResourceCommand,
  ): Promise<{ success: true }> {
    if (command === "remove-image") {
      if (
        !/^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,255}$/.test(resourceId) ||
        resourceId.includes("..")
      ) {
        throw new Error("Image reference contains unsupported characters.");
      }
    } else {
      assertIdentifier(resourceId, "Docker resource");
    }
    if (target.kind === "local") {
      if (command === "remove-volume") {
        await this.docker.getVolume(resourceId).remove();
      } else if (command === "remove-network") {
        await this.docker.getNetwork(resourceId).remove();
      } else {
        await this.docker.getImage(resourceId).remove({ force: true });
      }
    } else {
      const action =
        command === "remove-volume"
          ? "volume rm"
          : command === "remove-network"
            ? "network rm"
            : "image rm --force";
      const safeResource = shellQuote(resourceId);
      await this.executeRemote(target, `docker ${action} ${safeResource}`);
    }
    return { success: true };
  }

  async prune(
    target: DockerInspectionTarget,
    type: DockerPruneType,
    options: DockerPruneOptions = {},
  ): Promise<{ success: true; output: string[] }> {
    const imageFilter =
      options.preserveRollbackImages !== false
        ? " --filter 'label!=com.upstand.rollback.keep=true'"
        : "";
    const actionArgs: Record<Exclude<DockerPruneType, "all">, string> = {
      images: `docker image prune --all --force${imageFilter}`,
      volumes: "docker volume prune --all --force",
      containers: "docker container prune --force",
      builder: "docker builder prune --all --force",
      networks: "docker network prune --force",
      system: `docker system prune --all --force${imageFilter}`,
    };
    const parsedActions =
      type === "all"
        ? ([
            "containers",
            "images",
            "volumes",
            "builder",
            "system",
            ...(options.pruneNetworks ? (["networks"] as const) : []),
          ] as const)
        : [type];

    if (target.kind === "local") {
      const cleanupService = new DockerCleanupService();
      const result =
        options.preserveRollbackImages === false || options.pruneNetworks
          ? await cleanupService.run(type, {}, options)
          : await cleanupService.run(type);
      return { success: true, output: result.output };
    }
    const output: string[] = [];
    for (const action of parsedActions) {
      const cmd = actionArgs[action];
      const result = await this.executeRemote(target, cmd);
      output.push(`${action}: ${result.trim()}`);
    }
    return { success: true, output };
  }

  async execContainerCommand(
    target: DockerInspectionTarget,
    containerId: string,
    command: string,
    options?: { timeoutSeconds?: number; onLog?: (chunk: string) => void },
  ): Promise<{ output: string; exitCode?: number }> {
    assertIdentifier(containerId, "Container");
    if (target.kind === "local") {
      const container = this.docker.getContainer(containerId);
      const exec = await container.exec({
        Cmd: ["sh", "-c", command],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ Detach: false });
      const chunks: Buffer[] = [];
      const timeoutMs = (options?.timeoutSeconds ?? 300) * 1000;

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          try {
            if ("destroy" in stream && typeof stream.destroy === "function") {
              stream.destroy();
            }
          } catch {}
          reject(
            new Error(
              `Container command execution timed out after ${options?.timeoutSeconds ?? 300}s`,
            ),
          );
        }, timeoutMs);

        stream.on("data", (chunk: Buffer) => {
          chunks.push(Buffer.from(chunk));
          if (options?.onLog) {
            const cleaned = this.cleanDockerLogs(Buffer.from(chunk));
            if (cleaned) options.onLog(cleaned);
          }
        });
        stream.on("end", () => {
          clearTimeout(timer);
          resolve();
        });
        stream.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      const cleanOutput = this.cleanDockerLogs(Buffer.concat(chunks));
      let exitCode = 0;
      try {
        const inspect = await exec.inspect();
        exitCode = inspect.ExitCode ?? 0;
      } catch {}
      return { output: cleanOutput, exitCode };
    }
    const safeContainer = shellQuote(containerId);
    const safeCommand = shellQuote(command);
    const output = await this.executeRemote(
      target,
      `docker exec ${safeContainer} sh -c ${safeCommand}`,
    );
    if (options?.onLog && output) {
      options.onLog(output);
    }
    return { output, exitCode: 0 };
  }

  async execServerTerminalCommand(
    target: DockerInspectionTarget,
    command: string,
  ): Promise<{ output: string }> {
    if (target.kind === "local") {
      const isWin = process.platform === "win32";
      const file = isWin ? "cmd.exe" : "sh";
      const args = isWin ? ["/c", command] : ["-c", command];
      const { stdout, stderr } = await execFileAsync(file, args, {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      return { output: stdout || stderr };
    }
    const output = await this.executeRemote(target, command);
    return { output };
  }

  async getInfo(target: DockerInspectionTarget): Promise<DockerInfo> {
    if (target.kind === "local") return dockerInfo(await this.docker.info());
    const raw = await this.executeRemote(
      target,
      "docker info --format '{{json .}}'",
    );
    return dockerInfo(JSON.parse(raw));
  }

  async listSwarmNodes(target: DockerInspectionTarget): Promise<
    Array<{
      id: string;
      hostname: string;
      ip: string;
      isLeader: boolean;
    }>
  > {
    if (target.kind !== "local") return [];
    const info = await this.docker.info();
    if (info.Swarm?.LocalNodeState !== "active") return [];
    const nodes = await this.docker.listNodes();
    return nodes.map((node) => ({
      id: node.ID || "",
      hostname: node.Description?.Hostname || node.ID || "",
      ip: node.Status?.Addr || "127.0.0.1",
      isLeader: Boolean(node.ManagerStatus?.Leader),
    }));
  }

  async getHostTime(
    target: DockerInspectionTarget,
  ): Promise<{ epochSeconds: number; iso: string }> {
    if (target.kind === "local") {
      const now = Date.now();
      return {
        epochSeconds: Math.floor(now / 1000),
        iso: new Date(now).toISOString(),
      };
    }
    const raw = await this.executeRemote(target, "date -u +%s");
    const epochSeconds = Number.parseInt(raw.trim(), 10);
    if (!Number.isSafeInteger(epochSeconds)) {
      throw new Error(`Unable to read host time from ${target.name}.`);
    }
    return { epochSeconds, iso: new Date(epochSeconds * 1000).toISOString() };
  }

  async listContainers(
    target: DockerInspectionTarget,
    filter?: { search?: string; state?: string },
  ): Promise<DockerContainer[]> {
    if (target.kind === "local") {
      const containers = await this.docker.listContainers({ all: true });
      return containers
        .map((container) => {
          const value = container as typeof container & {
            Mounts?: Array<{
              Name?: string;
              Source?: string;
              Destination?: string;
            }>;
            Networks?: Record<string, unknown>;
            Labels?: Record<string, string>;
          };
          return {
            id: container.Id,
            name:
              container.Names?.[0]?.replace(/^\//, "") ||
              container.Id.slice(0, 12),
            image: container.Image || "unknown",
            state: container.State || "unknown",
            status: container.Status || "unknown",
            ports: formatPorts(container.Ports),
            mounts: (value.Mounts || [])
              .map(
                (mount) =>
                  mount.Name ||
                  (mount.Source && mount.Destination
                    ? `${mount.Source}:${mount.Destination}`
                    : mount.Destination),
              )
              .filter((mount): mount is string => Boolean(mount)),
            networks: Object.keys(value.Networks || {}),
            labels: Object.entries(value.Labels || {}).map(
              ([key, value]) => `${key}=${value}`,
            ),
            createdAt: container.Created
              ? new Date(container.Created * 1000).toISOString()
              : null,
          };
        })
        .filter((container) => this.matchesContainer(container, filter));
    }
    const rows = parseJsonLines(
      await this.executeRemote(target, "docker ps --all --format '{{json .}}'"),
    );
    return rows
      .map((row) => ({
        id: asString(row.ID),
        name: asString(row.Names),
        image: asString(row.Image),
        state: asString(row.State),
        status: asString(row.Status),
        ports: asString(row.Ports, ""),
        mounts: asString(row.Mounts, "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        networks: asString(row.Networks, "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        labels: asString(row.Labels, "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        createdAt: null,
      }))
      .filter((container) => this.matchesContainer(container, filter));
  }

  async listImages(target: DockerInspectionTarget): Promise<DockerImage[]> {
    if (target.kind === "local") {
      const images = await this.docker.listImages({ all: true });
      return images.map((image) => ({
        id: image.Id,
        tags: image.RepoTags || [],
        sizeBytes: image.Size || 0,
        createdAt: image.Created
          ? new Date(image.Created * 1000).toISOString()
          : null,
      }));
    }
    const rows = parseJsonLines(
      await this.executeRemote(
        target,
        "docker images --all --format '{{json .}}'",
      ),
    );
    return rows.map((row) => ({
      id: asString(row.ID),
      tags: [
        `${asString(row.Repository, "<none>")}:${asString(row.Tag, "<none>")}`,
      ],
      sizeBytes: 0,
      createdAt: null,
    }));
  }

  async listVolumes(target: DockerInspectionTarget): Promise<DockerVolume[]> {
    if (target.kind === "local") {
      const result = await this.docker.listVolumes();
      return (result.Volumes || []).map((volume) => ({
        name: volume.Name,
        driver: volume.Driver,
        mountpoint: volume.Mountpoint,
      }));
    }
    const rows = parseJsonLines(
      await this.executeRemote(
        target,
        "docker volume ls --format '{{json .}}'",
      ),
    );
    return rows.map((row) => ({
      name: asString(row.Name),
      driver: asString(row.Driver),
      mountpoint: "",
    }));
  }

  async listNetworks(target: DockerInspectionTarget): Promise<DockerNetwork[]> {
    if (target.kind === "local") {
      const networks = await this.docker.listNetworks();
      return networks.map((network) => ({
        id: network.Id,
        name: network.Name,
        driver: network.Driver,
        scope: network.Scope,
        internal: Boolean(network.Internal),
        attachable: Boolean(network.Attachable),
      }));
    }
    const rows = parseJsonLines(
      await this.executeRemote(
        target,
        "docker network ls --format '{{json .}}'",
      ),
    );
    return rows.map((row) => ({
      id: asString(row.ID),
      name: asString(row.Name),
      driver: asString(row.Driver),
      scope: asString(row.Scope),
      internal: false,
      attachable: false,
    }));
  }

  async listServices(
    target: DockerInspectionTarget,
  ): Promise<DockerServiceSummary[]> {
    if (target.kind === "local") {
      const services = await this.docker.listServices();
      return services.map((service) => {
        const value = asRecord(service);
        const spec = asRecord(value.Spec);
        const taskTemplate = asRecord(spec.TaskTemplate);
        const containerSpec = asRecord(taskTemplate.ContainerSpec);
        const mode = asRecord(spec.Mode);
        const replicated = asRecord(mode.Replicated);
        return {
          id: asString(value.ID),
          name: asString(spec.Name),
          mode: Object.keys(mode)[0] || "unknown",
          replicas:
            replicated.Replicas === undefined
              ? "global"
              : String(replicated.Replicas),
          image: asString(containerSpec.Image),
          ports: formatPorts(asRecord(value.EndpointSpec).Ports),
        };
      });
    }
    const rows = parseJsonLines(
      await this.executeRemote(
        target,
        "docker service ls --format '{{json .}}'",
      ),
    );
    return rows.map((row) => ({
      id: asString(row.ID),
      name: asString(row.Name),
      mode: asString(row.Mode),
      replicas: asString(row.Replicas),
      image: asString(row.Image),
      ports: asString(row.Ports, ""),
    }));
  }

  async getLogs(
    target: DockerInspectionTarget,
    request: DockerLogRequest,
  ): Promise<string> {
    if (!request.containerId && !request.serviceName) {
      throw new Error("A container ID or service name is required.");
    }
    const identifier = request.containerId || request.serviceName;
    assertIdentifier(identifier as string, "Docker target");
    if (target.kind === "local") {
      const options = {
        stdout: true,
        stderr: true,
        tail: request.tail,
        timestamps: true,
        ...(request.since ? { since: request.since } : {}),
      };
      const buffer = request.containerId
        ? await this.docker.getContainer(request.containerId).logs(options)
        : await this.docker
            .getService(request.serviceName as string)
            .logs(options);
      const cleaned = cleanDockerLogs(buffer as Buffer | string);
      return filterDockerLogs(cleaned, request);
    }
    const safeTail = Math.max(1, Math.min(10000, Number(request.tail) || 100));
    const safeSince = request.since
      ? ` --since ${shellQuote(String(request.since))}`
      : "";
    const safeTarget = request.containerId
      ? shellQuote(request.containerId)
      : shellQuote(request.serviceName || "");
    const command = request.containerId
      ? `docker logs --tail ${safeTail} --timestamps${safeSince} ${safeTarget}`
      : `docker service logs --tail ${safeTail} --timestamps${safeSince} ${safeTarget}`;
    const remoteLogs = await this.executeRemote(target, command);
    return filterDockerLogs(cleanDockerLogs(remoteLogs), request);
  }

  async getContainerStats(
    target: DockerInspectionTarget,
    containerId: string,
  ): Promise<DockerContainerStats> {
    assertIdentifier(containerId, "Docker container");
    if (target.kind === "remote") {
      const safeContainer = shellQuote(containerId);
      const [row] = parseJsonLines(
        await this.executeRemote(
          target,
          `docker stats --no-stream --format '{{json .}}' ${safeContainer}`,
        ),
      );
      if (!row) throw new Error("Docker container stats were not returned.");
      const percent = (value: unknown) =>
        Number.parseFloat(String(value ?? "").replace("%", "")) || 0;
      const bytes = (value: unknown) => {
        const match = String(value ?? "").match(
          /^([0-9]+(?:\.[0-9]+)?)\s*([kmgt]?i?b)?$/i,
        );
        if (!match) return 0;
        const units = ["b", "kb", "mb", "gb", "tb"];
        const unit = (match[2] ?? "b").toLowerCase().replace("i", "");
        return (
          (Number(match[1]) || 0) * 1024 ** Math.max(0, units.indexOf(unit))
        );
      };
      const [memoryUsage, memoryLimit] = String(row.MemUsage ?? "")
        .split("/")
        .map((value) => bytes(value.trim()));
      const [networkRxBytes, networkTxBytes] = String(row.NetIO ?? "")
        .split("/")
        .map((value) => bytes(value.trim()));
      const [blockReadBytes, blockWriteBytes] = String(row.BlockIO ?? "")
        .split("/")
        .map((value) => bytes(value.trim()));
      return {
        containerId,
        cpuPercent: percent(row.CPUPerc),
        memoryUsageBytes: memoryUsage || 0,
        memoryLimitBytes: memoryLimit || 0,
        memoryPercent: memoryLimit
          ? ((memoryUsage || 0) / memoryLimit) * 100
          : 0,
        networkRxBytes: networkRxBytes || 0,
        networkTxBytes: networkTxBytes || 0,
        blockReadBytes: blockReadBytes || 0,
        blockWriteBytes: blockWriteBytes || 0,
        pids: Number(row.PIDs) || 0,
      };
    }

    const value = asRecord(
      await this.docker.getContainer(containerId).stats({ stream: false }),
    );
    const cpu = asRecord(value.cpu_stats);
    const previousCpu = asRecord(value.precpu_stats);
    const cpuUsage = asRecord(cpu.cpu_usage);
    const previousCpuUsage = asRecord(previousCpu.cpu_usage);
    const cpuDelta =
      Number(cpuUsage.total_usage ?? 0) -
      Number(previousCpuUsage.total_usage ?? 0);
    const systemDelta =
      Number(cpu.system_cpu_usage ?? 0) -
      Number(previousCpu.system_cpu_usage ?? 0);
    const onlineCpus =
      Number(cpu.online_cpus) ||
      (Array.isArray(cpuUsage.percpu_usage)
        ? cpuUsage.percpu_usage.length
        : 0) ||
      1;
    const memory = asRecord(value.memory_stats);
    const memoryUsageBytes = Number(memory.usage ?? 0);
    const memoryLimitBytes = Number(memory.limit ?? 0);
    const networkValues: unknown[] = Object.values(asRecord(value.networks));
    const networks: Record<string, unknown>[] = networkValues.filter(
      (item: unknown): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    );
    const blockIoStats = asRecord(value.blkio_stats);
    const blockDeviceValues: unknown[] = Array.isArray(
      blockIoStats.io_service_bytes_recursive,
    )
      ? blockIoStats.io_service_bytes_recursive
      : [];
    const blockDevices: Record<string, unknown>[] = blockDeviceValues.filter(
      (item: unknown): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    );
    return {
      containerId,
      cpuPercent:
        systemDelta > 0 ? (cpuDelta / systemDelta) * onlineCpus * 100 : 0,
      memoryUsageBytes,
      memoryLimitBytes,
      memoryPercent: memoryLimitBytes
        ? (memoryUsageBytes / memoryLimitBytes) * 100
        : 0,
      networkRxBytes: networks.reduce(
        (total: number, item: Record<string, unknown>): number =>
          total + Number(item.rx_bytes ?? 0),
        0,
      ),
      networkTxBytes: networks.reduce(
        (total: number, item: Record<string, unknown>): number =>
          total + Number(item.tx_bytes ?? 0),
        0,
      ),
      blockReadBytes: blockDevices
        .filter((item) => item.op === "Read")
        .reduce((total, item) => total + Number(item.value ?? 0), 0),
      blockWriteBytes: blockDevices
        .filter((item) => item.op === "Write")
        .reduce((total, item) => total + Number(item.value ?? 0), 0),
      pids: Number(asRecord(value.pids_stats).current ?? 0),
    };
  }

  async uploadArchiveToVolume(
    target: DockerInspectionTarget,
    volumeName: string,
    archive: Buffer,
    destination = "/",
  ): Promise<{ success: true; bytes: number; destination: string }> {
    assertIdentifier(volumeName, "Docker volume");
    if (
      !destination.startsWith("/") ||
      destination.includes("..") ||
      !/^\/[a-zA-Z0-9_.\-/]*$/.test(destination)
    ) {
      throw new Error("Upload destination must be a safe absolute path.");
    }
    if (archive.byteLength > 50 * 1024 * 1024) {
      throw new Error("Volume archives must not exceed 50 MB.");
    }

    if (target.kind === "local") {
      await this.ensureLocalHelperImage();
      const container = await this.docker.createContainer({
        Image: VOLUME_HELPER_IMAGE,
        Cmd: ["sh", "-c", "sleep 120"],
        HostConfig: {
          AutoRemove: true,
          Binds: [`${volumeName}:/upstand-volume`],
        },
      });
      try {
        await container.start();
        const destinationPath = `/upstand-volume${destination === "/" ? "" : destination}`;
        const mkdir = await container.exec({
          Cmd: ["mkdir", "-p", destinationPath],
          AttachStdout: false,
          AttachStderr: true,
        });
        const mkdirStream = await mkdir.start({});
        await new Promise<void>((resolve, reject) => {
          mkdirStream.on("end", resolve);
          mkdirStream.on("close", resolve);
          mkdirStream.on("error", reject);
        });
        const mkdirResult = await mkdir.inspect();
        if (mkdirResult.ExitCode !== 0) {
          throw new Error("Unable to prepare the volume upload destination.");
        }
        await container.putArchive(archive, { path: destinationPath });
      } finally {
        await container.remove({ force: true }).catch(() => undefined);
      }
    } else {
      const localArchive = path.join(
        tmpdir(),
        `upstand-volume-${randomUUID()}.tar`,
      );
      const remoteArchive = `/tmp/upstand-volume-${randomUUID()}.tar`;
      await writeFile(localArchive, archive);
      try {
        const destinationPath = `/upstand-volume${destination === "/" ? "" : destination}`;
        const safeDestination = shellQuote(destinationPath);
        const safeArchive = shellQuote(remoteArchive);
        const volumeBind = shellQuote(`${volumeName}:/upstand-volume`);
        const innerShCmd = shellQuote(
          `mkdir -p ${safeDestination} && tar -xf ${safeArchive} -C ${safeDestination}`,
        );
        const remoteCmd = `docker run --rm -v ${volumeBind} ${VOLUME_HELPER_IMAGE} sh -c ${innerShCmd}`;
        await this.executeRemote(target, remoteCmd);
      } finally {
        await rm(localArchive, { force: true });
        await this.executeRemote(
          target,
          `rm -f ${shellQuote(remoteArchive)}`,
        ).catch(() => undefined);
      }
    }

    return { success: true, bytes: archive.byteLength, destination };
  }

  async uploadArchiveToContainer(
    target: DockerInspectionTarget,
    containerId: string,
    archive: Buffer,
    destination = "/",
  ): Promise<{ success: true; bytes: number; destination: string }> {
    assertIdentifier(containerId, "Docker container");
    if (
      !destination.startsWith("/") ||
      destination.includes("..") ||
      !/^\/[a-zA-Z0-9_.\-/]*$/.test(destination)
    ) {
      throw new Error("Upload destination must be a safe absolute path.");
    }
    if (archive.byteLength > 50 * 1024 * 1024) {
      throw new Error("Container archives must not exceed 50 MB.");
    }

    if (target.kind === "local") {
      await this.docker
        .getContainer(containerId)
        .putArchive(archive, { path: destination });
    } else {
      const localArchive = path.join(
        tmpdir(),
        `upstand-container-${randomUUID()}.tar`,
      );
      const remoteArchive = `/tmp/upstand-container-${randomUUID()}.tar`;
      await writeFile(localArchive, archive);
      try {
        await this.uploadRemoteFile(target, localArchive, remoteArchive);
        const destinationPath = destination || "/";
        const safeDestination = shellQuote(destinationPath);
        const safeRemoteArchive = shellQuote(remoteArchive);
        const safeTargetUpload = shellQuote(
          `${containerId}:/tmp/upstand-upload.tar`,
        );
        const safeContainer = shellQuote(containerId);

        const cpCmd = `docker cp ${safeRemoteArchive} ${safeTargetUpload}`;
        const innerShCmd = shellQuote(
          `mkdir -p ${safeDestination} && tar -xf /tmp/upstand-upload.tar -C ${safeDestination} && rm -f /tmp/upstand-upload.tar`,
        );
        const execCmd = `docker exec ${safeContainer} sh -c ${innerShCmd}`;

        await this.executeRemote(target, `${cpCmd} && ${execCmd}`);
      } finally {
        await rm(localArchive, { force: true });
        await this.executeRemote(
          target,
          `rm -f ${shellQuote(remoteArchive)}`,
        ).catch(() => undefined);
      }
    }

    return { success: true, bytes: archive.byteLength, destination };
  }

  private matchesContainer(
    container: DockerContainer,
    filter?: { search?: string; state?: string },
  ): boolean {
    if (filter?.state && container.state !== filter.state) return false;
    if (!filter?.search) return true;
    const search = filter.search.toLowerCase();
    return [
      container.id,
      container.name,
      container.image,
      container.status,
      ...container.labels,
      ...container.networks,
    ].some((value) => value.toLowerCase().includes(search));
  }

  private executeRemote(
    target: Extract<DockerInspectionTarget, { kind: "remote" }>,
    command: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const connection = new Client();
      const timer = setTimeout(() => {
        connection.end();
        reject(new Error(`Remote Docker query timed out on ${target.name}.`));
      }, 20_000);
      connection
        .on("ready", () => {
          connection.exec(command, (error, stream) => {
            if (error) {
              clearTimeout(timer);
              connection.end();
              reject(error);
              return;
            }
            let stdout = "";
            let stderr = "";
            stream.on("data", (data: Buffer | string) => {
              stdout += data.toString();
              if (stdout.length > 512_000) stream.destroy();
            });
            stream.stderr.on("data", (data: Buffer | string) => {
              stderr += data.toString();
            });
            stream.on("close", (code: number | null) => {
              clearTimeout(timer);
              connection.end();
              if (code !== 0) {
                reject(
                  new Error(
                    stderr.trim() ||
                      `Remote Docker query exited with code ${code ?? "unknown"}.`,
                  ),
                );
                return;
              }
              resolve(stdout.slice(0, 512_000));
            });
          });
        })
        .on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        })
        .connect({
          host: target.host,
          port: target.port,
          username: target.username,
          privateKey: target.privateKey,
          readyTimeout: 20_000,
        });
    });
  }

  private async ensureLocalHelperImage(): Promise<void> {
    const image = this.docker.getImage(VOLUME_HELPER_IMAGE);
    try {
      await image.inspect();
      return;
    } catch {
      const stream = await this.docker.pull(VOLUME_HELPER_IMAGE);
      await new Promise<void>((resolve, reject) => {
        this.docker.modem.followProgress(stream, (error) =>
          error ? reject(error) : resolve(),
        );
      });
    }
  }

  private uploadRemoteFile(
    target: Extract<DockerInspectionTarget, { kind: "remote" }>,
    localPath: string,
    remotePath: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const connection = new Client();
      const timer = setTimeout(() => {
        connection.end();
        reject(new Error(`Remote Docker upload timed out on ${target.name}.`));
      }, 60_000);
      connection
        .on("ready", () => {
          connection.sftp((error, sftp) => {
            if (error) {
              clearTimeout(timer);
              connection.end();
              reject(error);
              return;
            }
            sftp.fastPut(localPath, remotePath, (putError) => {
              clearTimeout(timer);
              connection.end();
              if (putError) reject(putError);
              else resolve();
            });
          });
        })
        .on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        })
        .connect({
          host: target.host,
          port: target.port,
          username: target.username,
          privateKey: target.privateKey,
          readyTimeout: 20_000,
        });
    });
  }

  private cleanDockerLogs(buffer: Buffer): string {
    let result = "";
    let offset = 0;
    while (offset < buffer.length) {
      if (offset + 8 > buffer.length) break;
      const size = buffer.readUInt32BE(offset + 4);
      offset += 8;

      if (offset + size > buffer.length) {
        result += buffer.toString("utf8", offset);
        break;
      }

      result += buffer.toString("utf8", offset, offset + size);
      offset += size;
    }
    return result || buffer.toString("utf8");
  }
}
