import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type {
  ContainerFileItem,
  ContainerFileSystemPort,
  ContainerVolumeMount,
} from "@upstand/usecases/ports/container-file-system";
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
import {
  createDockerInspectionBrokerClient,
  createDockerResourceCommandBrokerClient,
  createDockerResourceFileBrokerClient,
  type DockerInspectionBrokerPort,
  type DockerResourceCommandBrokerPort,
  type DockerResourceFileBrokerPort,
} from "./docker-broker-client";
import { DockerCleanupService } from "./docker-cleanup.service";
import { getDockerInstance } from "./docker-client";

const execFileAsync = promisify(execFile);

const VOLUME_HELPER_IMAGE =
  "alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc";
const MAX_DOCKER_COMMAND_OUTPUT_BYTES = 50 * 1024 * 1024;
const MAX_REMOTE_DOCKER_ERROR_BYTES = 512 * 1024;

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const containerPathPattern = /^\/[^\\]*$/;

function hasUnsupportedControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
}

function assertContainerPath(value: string, label: string): void {
  if (
    !containerPathPattern.test(value) ||
    hasUnsupportedControlCharacters(value) ||
    value.includes("//") ||
    value.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error(`${label} must be a canonical absolute POSIX path.`);
  }
}

function assertMutableContainerPath(value: string, label: string): void {
  assertContainerPath(value, label);
  if (value === "/") {
    throw new Error(`${label} cannot target the mount root.`);
  }
}

function decodeBase64(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
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

function mountRecords(value: unknown): ContainerVolumeMount[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const mount = asRecord(entry);
    const type = asString(mount.Type, "").toLowerCase();
    const name = asString(mount.Name, "");
    const destination = asString(mount.Destination, "");
    if (type !== "volume" || !name || !destination) return [];
    try {
      assertContainerPath(destination, "Docker mount destination");
    } catch {
      return [];
    }
    return [
      {
        type: "volume" as const,
        name,
        destination,
        readOnly: mount.RW === false || asString(mount.Mode, "").includes("ro"),
      },
    ];
  });
}

function fileContext(mountPath: string, filePath: string): string {
  assertContainerPath(mountPath, "Mount path");
  assertContainerPath(filePath, "File path");
  const relative = filePath === "/" ? "" : filePath.slice(1);
  return [
    "set -eu",
    `root=${shellQuote(mountPath)}`,
    `relative=${shellQuote(relative)}`,
    'test -d "$root"',
    'root=$(cd -- "$root" && pwd -P)',
    'target="$root"',
    '[ -z "$relative" ] || target="$root/$relative"',
    'case "$target" in "$root"|"$root"/*) ;; *) echo "path escapes mount" >&2; exit 1 ;; esac',
  ].join("; ");
}

function existingFileGuard(): string {
  return [
    '[ -e "$target" ] || [ -L "$target" ]',
    '[ ! -L "$target" ] || { echo "symlink paths are not supported" >&2; exit 1; }',
    'resolved=$(readlink -f -- "$target")',
    '[ "$resolved" = "$target" ] || { echo "symlink paths are not supported" >&2; exit 1; }',
  ].join("; ");
}

function parentFileGuard(): string {
  return [
    String.raw`parent="\${target%/*}"`,
    'test -d "$parent"',
    'parent_resolved=$(readlink -f -- "$parent")',
    '[ "$parent_resolved" = "$parent" ] || { echo "symlink paths are not supported" >&2; exit 1; }',
    '[ ! -e "$target" ] || [ ! -L "$target" ] || { echo "symlink paths are not supported" >&2; exit 1; }',
  ].join("; ");
}

export class DockerReadOnlyService
  implements DockerExecPort, ContainerFileSystemPort
{
  constructor(
    private readonly docker: Docker = getDockerInstance(),
    private readonly broker:
      | DockerInspectionBrokerPort
      | undefined = createDockerInspectionBrokerClient(),
    private readonly resourceFileBroker:
      | DockerResourceFileBrokerPort
      | undefined = createDockerResourceFileBrokerClient(),
    private readonly resourceCommandBroker:
      | DockerResourceCommandBrokerPort
      | undefined = createDockerResourceCommandBrokerClient(),
  ) {}

  async getContainerMounts(
    target: DockerInspectionTarget,
    containerId: string,
    resourceId: string,
  ): Promise<ContainerVolumeMount[]> {
    if (target.kind === "local" && this.resourceFileBroker) {
      return this.resourceFileBroker.getContainerMounts(
        target,
        containerId,
        resourceId,
      );
    }
    assertIdentifier(containerId, "Container");
    if (target.kind === "local") {
      const inspected = await this.docker.getContainer(containerId).inspect();
      return mountRecords(inspected.Mounts);
    }
    const output = await this.executeRemote(
      target,
      `docker inspect --type container --format '{{json .Mounts}}' ${shellQuote(containerId)}`,
    );
    try {
      return mountRecords(JSON.parse(output));
    } catch {
      throw new Error("Docker returned invalid container mount metadata.");
    }
  }

  async listFiles(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    filePath: string,
    resourceId: string,
  ): Promise<ContainerFileItem[]> {
    if (target.kind === "local" && this.resourceFileBroker) {
      return this.resourceFileBroker.listFiles(
        target,
        containerId,
        mountPath,
        filePath,
        resourceId,
      );
    }
    const command = [
      fileContext(mountPath, filePath),
      'test -d "$target"',
      'for entry in "$target"/* "$target"/.[!.]* "$target"/..?*; do',
      '  [ -e "$entry" ] || [ -L "$entry" ] || continue',
      String.raw`  name=\${entry##*/}`,
      '  if [ -L "$entry" ]; then type=symlink; elif [ -d "$entry" ]; then type=directory; elif [ -f "$entry" ]; then type=file; else type=other; fi',
      "  size=0; mode=000; updated=0",
      '  stat_out=$(stat -c "%s|%a|%Y" -- "$entry" 2>/dev/null || true)',
      '  [ -z "$stat_out" ] || IFS="|" read -r size mode updated <<EOF\n$stat_out\nEOF',
      '  encoded=$(printf "%s" "$name" | base64 | tr -d "\\n")',
      '  printf "%s|%s|%s|%s|%s\\n" "$type" "$size" "$mode" "$updated" "$encoded"',
      "done",
    ].join("\n");
    const result = await this.execFileSystemCommand(
      target,
      containerId,
      command,
    );
    return result
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const [type, rawSize, rawMode, rawUpdated, encodedName] =
          line.split("|");
        if (!encodedName || !type) return [];
        const name = decodeBase64(encodedName);
        const parent = filePath === "/" ? "" : filePath;
        return [
          {
            name,
            path: `${parent}/${name}`.replace(/^\/(.*)\/$/, "/$1"),
            type: (["file", "directory", "symlink", "other"] as const).includes(
              type as ContainerFileItem["type"],
            )
              ? (type as ContainerFileItem["type"])
              : "other",
            sizeBytes: Number.parseInt(rawSize || "0", 10) || 0,
            permissions: rawMode || "000",
            updatedAt: new Date(
              (Number.parseInt(rawUpdated || "0", 10) || 0) * 1000,
            ).toISOString(),
          },
        ];
      });
  }

  async readFile(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    filePath: string,
    _encoding: "text" | "base64",
    resourceId: string,
  ): Promise<{ content: string }> {
    if (target.kind === "local" && this.resourceFileBroker) {
      return this.resourceFileBroker.readFile(
        target,
        containerId,
        mountPath,
        filePath,
        "base64",
        resourceId,
      );
    }
    const command = [
      fileContext(mountPath, filePath),
      existingFileGuard(),
      'test -f "$target" || { echo "path is not a regular file" >&2; exit 1; }',
      'bytes=$(wc -c < "$target")',
      '[ "$bytes" -le 10485760 ] || { echo "file exceeds the 10 MB size limit" >&2; exit 1; }',
      'base64 "$target" | tr -d "\\n"',
    ].join("\n");
    return {
      content: await this.execFileSystemCommand(target, containerId, command),
    };
  }

  async writeFile(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    filePath: string,
    contentBase64: string,
    resourceId: string,
  ): Promise<void> {
    if (target.kind === "local" && this.resourceFileBroker) {
      await this.resourceFileBroker.writeFile(
        target,
        containerId,
        mountPath,
        filePath,
        contentBase64,
        resourceId,
      );
      return;
    }
    assertMutableContainerPath(filePath, "File path");
    const command = [
      fileContext(mountPath, filePath),
      parentFileGuard(),
      'tmp=$(mktemp "$target.upstand.XXXXXX")',
      'cleanup() { rm -f -- "$tmp"; }',
      "trap cleanup EXIT",
      'base64 -d > "$tmp"',
      'bytes=$(wc -c < "$tmp")',
      '[ "$bytes" -le 10485760 ] || { echo "file exceeds the 10 MB size limit" >&2; exit 1; }',
      'if [ -e "$target" ]; then chmod --reference="$target" "$tmp" 2>/dev/null || true; fi',
      'mv -f -- "$tmp" "$target"',
      "trap - EXIT",
    ].join("; ");
    await this.execFileSystemInput(target, containerId, command, contentBase64);
  }

  async createItem(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    filePath: string,
    type: "file" | "directory",
    resourceId: string,
  ): Promise<void> {
    if (target.kind === "local" && this.resourceFileBroker) {
      await this.resourceFileBroker.createItem(
        target,
        containerId,
        mountPath,
        filePath,
        type,
        resourceId,
      );
      return;
    }
    assertMutableContainerPath(filePath, "File path");
    const command = [
      fileContext(mountPath, filePath),
      parentFileGuard(),
      '[ ! -e "$target" ] && [ ! -L "$target" ]',
      type === "directory" ? 'mkdir -- "$target"' : ': > "$target"',
    ].join("; ");
    await this.execFileSystemCommand(target, containerId, command);
  }

  async renameItem(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    oldPath: string,
    newPath: string,
    resourceId: string,
  ): Promise<void> {
    if (target.kind === "local" && this.resourceFileBroker) {
      await this.resourceFileBroker.renameItem(
        target,
        containerId,
        mountPath,
        oldPath,
        newPath,
        resourceId,
      );
      return;
    }
    assertMutableContainerPath(oldPath, "Original path");
    assertMutableContainerPath(newPath, "New path");
    const oldContext = fileContext(mountPath, oldPath);
    const newRelative = newPath === "/" ? "" : newPath.slice(1);
    assertContainerPath(newPath, "New path");
    const command = [
      oldContext,
      `new_relative=${shellQuote(newRelative)}`,
      'new_target="$root"',
      '[ -z "$new_relative" ] || new_target="$root/$new_relative"',
      'case "$new_target" in "$root"|"$root"/*) ;; *) echo "path escapes mount" >&2; exit 1 ;; esac',
      existingFileGuard(),
      'target="$new_target"',
      parentFileGuard(),
      '[ ! -e "$target" ] && [ ! -L "$target" ]',
      'target="$root/$relative"',
      'mv -- "$target" "$new_target"',
    ].join("; ");
    await this.execFileSystemCommand(target, containerId, command);
  }

  async deleteItem(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    filePath: string,
    resourceId: string,
  ): Promise<void> {
    if (target.kind === "local" && this.resourceFileBroker) {
      await this.resourceFileBroker.deleteItem(
        target,
        containerId,
        mountPath,
        filePath,
        resourceId,
      );
      return;
    }
    assertMutableContainerPath(filePath, "Delete path");
    const command = [
      fileContext(mountPath, filePath),
      existingFileGuard(),
      'rm -rf -- "$target"',
    ].join("; ");
    await this.execFileSystemCommand(target, containerId, command);
  }

  async changePermissions(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    filePath: string,
    mode: string,
    resourceId: string,
  ): Promise<void> {
    if (target.kind === "local" && this.resourceFileBroker) {
      await this.resourceFileBroker.changePermissions(
        target,
        containerId,
        mountPath,
        filePath,
        mode,
        resourceId,
      );
      return;
    }
    assertMutableContainerPath(filePath, "File path");
    if (!/^[0-7]{3,4}$/.test(mode)) {
      throw new Error("Permission mode must be an octal string.");
    }
    const command = [
      fileContext(mountPath, filePath),
      existingFileGuard(),
      `chmod -- ${shellQuote(mode)} "$target"`,
    ].join("; ");
    await this.execFileSystemCommand(target, containerId, command);
  }

  async searchFiles(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    filePath: string,
    query: string,
    resourceId: string,
  ): Promise<ContainerFileItem[]> {
    if (target.kind === "local" && this.resourceFileBroker) {
      return this.resourceFileBroker.searchFiles(
        target,
        containerId,
        mountPath,
        filePath,
        query,
        resourceId,
      );
    }
    if (hasUnsupportedControlCharacters(query)) {
      throw new Error("Search query contains unsupported control characters.");
    }
    const command = [
      fileContext(mountPath, filePath),
      'test -d "$target"',
      `query=${shellQuote(query)}`,
      'find -P "$target" -mindepth 1 -maxdepth 4 -print 2>/dev/null | while IFS= read -r entry; do',
      String.raw`  name=\${entry##*/}`,
      '  case "$name" in *"$query"*) ;; *) continue ;; esac',
      '  if [ -L "$entry" ]; then type=symlink; elif [ -d "$entry" ]; then type=directory; elif [ -f "$entry" ]; then type=file; else type=other; fi',
      "  size=0; mode=000; updated=0",
      '  stat_out=$(stat -c "%s|%a|%Y" -- "$entry" 2>/dev/null || true)',
      '  [ -z "$stat_out" ] || IFS="|" read -r size mode updated <<EOF\n$stat_out\nEOF',
      String.raw`  relative=\${entry#"$root"}; encoded=$(printf "%s" "$relative" | base64 | tr -d "\\n")`,
      '  printf "%s|%s|%s|%s|%s\\n" "$type" "$size" "$mode" "$updated" "$encoded"',
      "done",
    ].join("\n");
    return (await this.execFileSystemCommand(target, containerId, command))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const [type, rawSize, rawMode, rawUpdated, encodedPath] =
          line.split("|");
        if (!encodedPath) return [];
        const path = decodeBase64(encodedPath);
        const name = path.split("/").pop() || path;
        return [
          {
            name,
            path,
            type: (["file", "directory", "symlink", "other"] as const).includes(
              type as ContainerFileItem["type"],
            )
              ? (type as ContainerFileItem["type"])
              : "other",
            sizeBytes: Number.parseInt(rawSize || "0", 10) || 0,
            permissions: rawMode || "000",
            updatedAt: new Date(
              (Number.parseInt(rawUpdated || "0", 10) || 0) * 1000,
            ).toISOString(),
          },
        ];
      });
  }

  async controlContainer(
    target: DockerInspectionTarget,
    containerId: string,
    command: DockerContainerCommand,
  ): Promise<{ success: true }> {
    if (target.kind === "local" && this.broker) {
      return this.broker.controlContainer(target, containerId, command);
    }
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
    if (target.kind === "local" && this.broker) {
      return this.broker.controlResource(target, resourceId, command);
    }
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
    if (target.kind === "local" && this.broker) {
      return this.broker.prune(target, type, options);
    }
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
    resourceId?: string,
  ): Promise<{ output: string; exitCode?: number }> {
    if (target.kind === "local" && this.resourceCommandBroker && resourceId) {
      return this.resourceCommandBroker.execContainerCommand(
        target,
        containerId,
        command,
        options,
        resourceId,
      );
    }
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
      let outputBytes = 0;
      const timeoutMs = (options?.timeoutSeconds ?? 300) * 1000;

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
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

        stream.on("data", (chunk: Buffer | string) => {
          if (settled) return;
          const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          outputBytes += buffer.byteLength;
          if (outputBytes > MAX_DOCKER_COMMAND_OUTPUT_BYTES) {
            settled = true;
            clearTimeout(timer);
            try {
              stream.destroy();
            } catch {}
            reject(
              new Error(
                `Container command output exceeded the ${MAX_DOCKER_COMMAND_OUTPUT_BYTES}-byte limit`,
              ),
            );
            return;
          }
          chunks.push(buffer);
          if (options?.onLog) {
            const cleaned = this.cleanDockerLogs(buffer);
            if (cleaned) options.onLog(cleaned);
          }
        });
        stream.on("end", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        });
        stream.on("error", (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
      });
      const cleanOutput = this.cleanDockerLogs(Buffer.concat(chunks));
      const inspect = await exec.inspect();
      const exitCode = inspect.ExitCode ?? 0;
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

  private async execFileSystemCommand(
    target: DockerInspectionTarget,
    containerId: string,
    command: string,
  ): Promise<string> {
    const result = await this.execContainerCommand(
      target,
      containerId,
      command,
      {
        timeoutSeconds: 30,
      },
    );
    if (result.exitCode !== undefined && result.exitCode !== 0) {
      throw new Error(
        result.output.trim() || "Container file operation failed.",
      );
    }
    return result.output;
  }

  private async execFileSystemInput(
    target: DockerInspectionTarget,
    containerId: string,
    command: string,
    input: string,
  ): Promise<void> {
    assertIdentifier(containerId, "Container");
    if (target.kind === "remote") {
      await this.executeRemoteWithInput(
        target,
        `docker exec -i ${shellQuote(containerId)} sh -c ${shellQuote(command)}`,
        input,
      );
      return;
    }

    const exec = await this.docker.getContainer(containerId).exec({
      Cmd: ["sh", "-c", command],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    const stream = await exec.start({ Detach: false, hijack: true });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        stream.destroy?.();
        reject(new Error("Container file write timed out after 30s."));
      }, 30_000);
      stream.on("data", (chunk: Buffer | string) => {
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        chunks.push(buffer);
        if (
          Buffer.concat(chunks).byteLength > MAX_DOCKER_COMMAND_OUTPUT_BYTES
        ) {
          settled = true;
          clearTimeout(timer);
          stream.destroy?.();
          reject(
            new Error("Container file operation output exceeded its limit."),
          );
        }
      });
      stream.on("error", (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      stream.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });
      stream.write(Buffer.from(input, "utf8"));
      stream.end();
    });
    const inspected = await exec.inspect();
    if ((inspected.ExitCode ?? 0) !== 0) {
      throw new Error(
        this.cleanDockerLogs(Buffer.concat(chunks)).trim() ||
          "Container file write failed.",
      );
    }
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
    if (target.kind === "local" && this.broker) {
      return this.broker.getInfo(target);
    }
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
      role?: string;
      status?: string;
      isLocalNode?: boolean;
    }>
  > {
    if (target.kind === "local" && this.broker) {
      return this.broker.listSwarmNodes(target);
    }
    if (target.kind === "local") {
      const info = await this.docker.info();
      if (info.Swarm?.LocalNodeState !== "active") return [];
      const nodes = await this.docker.listNodes();
      return nodes.map((node) => ({
        id: node.ID || "",
        hostname: node.Description?.Hostname || node.ID || "",
        ip: node.Status?.Addr || "127.0.0.1",
        isLeader: Boolean(node.ManagerStatus?.Leader),
        role: node.Spec?.Role || "worker",
        status: node.Status?.State || "unknown",
        isLocalNode: node.ID === info.Swarm?.NodeID,
      }));
    }

    const rows = parseJsonLines(
      await this.executeRemote(target, "docker node ls --format '{{json .}}'"),
    );
    return rows.map((row) => ({
      id: asString(row.ID),
      hostname: asString(row.Hostname, asString(row.Name, asString(row.ID))),
      ip: asString(row.Addr),
      isLeader: asString(row.ManagerStatus).toLowerCase().includes("leader"),
      role: asString(row.ManagerStatus).trim() ? "manager" : "worker",
      status: asString(row.Status, "unknown"),
      isLocalNode: asString(row.Self).toLowerCase() === "true",
    }));
  }

  async getHostTime(
    target: DockerInspectionTarget,
  ): Promise<{ epochSeconds: number; iso: string }> {
    if (target.kind === "local" && this.broker) {
      return this.broker.getHostTime(target);
    }
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
    if (target.kind === "local" && this.broker) {
      return this.broker.listContainers(target, filter);
    }
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
    if (target.kind === "local" && this.broker) {
      return this.broker.listImages(target);
    }
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
    if (target.kind === "local" && this.broker) {
      return this.broker.listVolumes(target);
    }
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
    if (target.kind === "local" && this.broker) {
      return this.broker.listNetworks(target);
    }
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
    if (target.kind === "local" && this.broker) {
      return this.broker.listServices(target);
    }
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
    if (target.kind === "local" && this.broker) {
      return this.broker.getLogs(target, request);
    }
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
    if (target.kind === "local" && this.broker) {
      return this.broker.getContainerStats(target, containerId);
    }
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
            let settled = false;
            const fail = (error: unknown) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              connection.end();
              reject(error instanceof Error ? error : new Error(String(error)));
            };
            stream.on("data", (data: Buffer | string) => {
              if (settled) return;
              stdout += data.toString();
              if (stdout.length > MAX_DOCKER_COMMAND_OUTPUT_BYTES) {
                stream.destroy();
                fail(
                  new Error(
                    `Remote Docker query output exceeded the ${MAX_DOCKER_COMMAND_OUTPUT_BYTES}-byte limit.`,
                  ),
                );
              }
            });
            stream.stderr.on("data", (data: Buffer | string) => {
              if (settled) return;
              stderr += data.toString();
              if (stderr.length > MAX_REMOTE_DOCKER_ERROR_BYTES) {
                stream.destroy();
                fail(
                  new Error(
                    `Remote Docker query error output exceeded the ${MAX_REMOTE_DOCKER_ERROR_BYTES}-byte limit.`,
                  ),
                );
              }
            });
            stream.on("close", (code: number | null) => {
              if (settled) return;
              settled = true;
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
              resolve(stdout);
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
          password: target.password,
          readyTimeout: 20_000,
        });
    });
  }

  private executeRemoteWithInput(
    target: Extract<DockerInspectionTarget, { kind: "remote" }>,
    command: string,
    input: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const connection = new Client();
      const timer = setTimeout(() => {
        connection.end();
        reject(
          new Error(`Remote Docker file write timed out on ${target.name}.`),
        );
      }, 30_000);
      connection
        .on("ready", () => {
          connection.exec(command, (error, stream) => {
            if (error) {
              clearTimeout(timer);
              connection.end();
              reject(error);
              return;
            }
            let stderr = "";
            let settled = false;
            const fail = (failure: unknown) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              connection.end();
              reject(
                failure instanceof Error ? failure : new Error(String(failure)),
              );
            };
            stream.stderr.on("data", (data: Buffer | string) => {
              stderr += data.toString();
              if (stderr.length > MAX_REMOTE_DOCKER_ERROR_BYTES) {
                stream.destroy();
                fail(
                  new Error(
                    "Remote Docker file operation error exceeded its limit.",
                  ),
                );
              }
            });
            stream.on("error", fail);
            stream.on("close", (code: number | null) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              connection.end();
              if (code !== 0) {
                reject(
                  new Error(
                    stderr.trim() || "Remote Docker file write failed.",
                  ),
                );
              } else {
                resolve();
              }
            });
            stream.end(Buffer.from(input, "utf8"));
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
          password: target.password,
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
          password: target.password,
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
