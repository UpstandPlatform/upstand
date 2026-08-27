import { exec, execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import fs from "node:fs";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import {
  type ApplicationBuildConfig,
  ConflictError,
  isSupportedDatabaseImage,
  parseApplicationBuildConfig,
  parseResourceAdvancedConfig,
  type Resource,
  type ResourceAdvancedConfig,
} from "@upstand/domain";
import { env, getInheritedEnv } from "@upstand/env/server";
import { isBlockedAddress } from "@upstand/platform/network/outbound";
import { redis } from "@upstand/redis";
import {
  assertManagedDatabaseCredentials,
  assertSafeGitNetworkUrl,
  assertSafeGitRef,
  assertSafeGitUrl,
  detectBuildConfig,
  normalizeBuildImageTag,
} from "@upstand/usecases";
import type {
  ContainerRuntimeStats,
  ConvergenceOptions,
  ConvergenceResult,
  DeploymentRevisionOptions,
  DockerApiTarget,
  DockerInspectionTarget,
  DockerRegistryAuth,
  DockerResourceContainer,
  DockerSelfUpdateServiceInspection,
  DockerSelfUpdateServiceSummary,
  DockerSelfUpdateServiceUpdate,
  DockerSelfUpdateTaskTemplate,
  ResolvedBuildArtifact,
  ServerRuntimeStats,
} from "@upstand/usecases/ports/docker";
import type {
  DockerSwarmInfoPort,
  DockerSwarmInspectionPort,
  DockerSwarmManagementPort,
  DockerSwarmNodePort,
  DockerSwarmTaskPort,
} from "@upstand/usecases/ports/swarm";
import { getApplicationBuildSecrets } from "@upstand/usecases/resource/application-build-secrets";
import { randomizeComposeFile } from "@upstand/usecases/resource/compose-randomization";
import {
  applyComposeIngressNetwork,
  applyComposeResourceConfig,
} from "@upstand/usecases/resource/docker-compose-config";
import {
  cleanDockerLogs,
  type DockerLogLevel,
  filterDockerLogs,
} from "@upstand/usecases/resource/docker-log-filter";
import {
  isUnknownRecord,
  numberValue,
  stringValue,
  sumDockerUsage,
} from "@upstand/usecases/resource/docker-values";
import { LIBSQL_CONTAINER_PORTS } from "@upstand/usecases/resource/libsql-settings";
import { parseResourceCredentials } from "@upstand/usecases/resource/resource-credentials";
import { parseResourceEnvironmentVariables } from "@upstand/usecases/resource/resource-environment";
import {
  ensureResourceOverlayNetwork,
  ensureUpstandOverlayNetwork,
  getResourceOverlayNetworkName,
  isManager,
  isSwarmActive,
} from "@upstand/usecases/swarm/swarm.helpers";
import type Docker from "dockerode";
import { log } from "evlog";
import yaml from "yaml";
import {
  createDockerResourceCommandBrokerClient,
  type DockerResourceCommandBrokerPort,
} from "./docker-broker-client";
import { getDockerInstance } from "./docker-client";
import { createPinnedGitSshEnvironment, isSshGitUrl } from "./git-host-key";

function isDockerTarget(value: unknown): value is Docker {
  return (
    isUnknownRecord(value) &&
    typeof value.info === "function" &&
    typeof value.getContainer === "function" &&
    typeof value.getNetwork === "function"
  );
}

function requireDockerTarget(value: DockerApiTarget): Docker {
  if (!isDockerTarget(value)) {
    throw new Error("A valid Docker daemon target is required");
  }
  return value;
}

type DockerImageTarget = Pick<Docker, "loadImage">;
type MutableContainerSpec = Docker.ContainerSpec & Record<string, unknown>;
type ResourceScopedDockerFactory = (resourceId: string) => Docker;

function isDockerImageTarget(value: unknown): value is DockerImageTarget {
  return isUnknownRecord(value) && typeof value.loadImage === "function";
}

function requireDockerImageTarget(value: DockerApiTarget): DockerImageTarget {
  if (!isDockerImageTarget(value)) {
    throw new Error("A Docker image target is required");
  }
  return value;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function errorStatusCode(value: unknown): number | undefined {
  if (!isUnknownRecord(value)) return undefined;
  return typeof value.statusCode === "number" ? value.statusCode : undefined;
}

function stopReadableStream(stream: NodeJS.ReadableStream): void {
  if ("destroy" in stream && typeof stream.destroy === "function") {
    stream.destroy();
  }
}

const DEFAULT_CONTAINER_COMMAND_TIMEOUT_SECONDS = 300;
const MAX_CONTAINER_COMMAND_OUTPUT_BYTES = 50 * 1024 * 1024;
const MAX_RESOURCE_COMMAND_BYTES = 32 * 1024;
const MAX_WEB_SERVER_LOG_BYTES = 5 * 1024 * 1024;
const WEB_SERVER_COMMAND_TIMEOUT_MS = 30_000;
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

async function readDockerStream(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      stopReadableStream(stream);
      reject(error);
    };
    stream.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      totalBytes += buffer.byteLength;
      if (totalBytes > maxBytes) {
        fail(new Error(`Docker stream exceeded the ${maxBytes}-byte limit`));
        return;
      }
      chunks.push(buffer);
    });
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    stream.on("error", fail);
  });
  return Buffer.concat(chunks);
}
const DOCKER_STATS_CONCURRENCY = 16;
const DOCKER_STATS_TIMEOUT_MS = 10_000;

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) return [];

  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(DOCKER_STATS_CONCURRENCY, values.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= values.length) return;
        results[index] = await mapper(values[index] as T);
      }
    }),
  );

  return results;
}

interface DockerTaskStatus {
  State?: string;
  Err?: string;
  Health?: string;
  ContainerStatus?: { ContainerID?: string };
}

interface DockerTaskSnapshot {
  Status?: DockerTaskStatus;
  DesiredState?: string;
}

function parseDockerTask(value: unknown): DockerTaskSnapshot | null {
  if (!isUnknownRecord(value)) return null;
  const statusValue = value.Status;
  const status: DockerTaskStatus | undefined = isUnknownRecord(statusValue)
    ? {
        State:
          typeof statusValue.State === "string" ? statusValue.State : undefined,
        Err: typeof statusValue.Err === "string" ? statusValue.Err : undefined,
        ContainerStatus: isUnknownRecord(statusValue.ContainerStatus)
          ? {
              ContainerID:
                typeof statusValue.ContainerStatus.ContainerID === "string"
                  ? statusValue.ContainerStatus.ContainerID
                  : undefined,
            }
          : undefined,
      }
    : undefined;
  return {
    Status: status,
    DesiredState:
      typeof value.DesiredState === "string" ? value.DesiredState : undefined,
  };
}

export function redactCommandOutput(
  output: string,
  secrets: readonly string[],
): string {
  return [...new Set(secrets)]
    .filter((secret) => secret.length > 0)
    .sort((first, second) => second.length - first.length)
    .reduce(
      (redacted, secret) => redacted.replaceAll(secret, "[REDACTED]"),
      output,
    );
}

function writePrivateDeploymentFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 });
  // Windows does not expose POSIX owner/group permissions. On Unix-like
  // deployment hosts, make the restriction explicit even when the file was
  // created previously with a broader mode.
  if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
}

export function shouldSuppressComposeRestart(
  resource: Pick<Resource, "type" | "composeType">,
  command: string,
): boolean {
  return (
    command === "kill" &&
    resource.type === "compose" &&
    resource.composeType === "compose"
  );
}

export function applyComposePlacementConstraints(
  composeContent: string,
  constraints: readonly string[],
): string {
  if (
    constraints.some(
      (constraint) =>
        typeof constraint !== "string" || constraint.trim() === "",
    )
  ) {
    throw new Error("Swarm placement constraints must be non-empty strings");
  }

  const parsed: unknown = yaml.parse(composeContent);
  if (!isUnknownRecord(parsed) || !isUnknownRecord(parsed.services)) {
    throw new Error("Compose document must contain a services object");
  }

  for (const [serviceName, rawService] of Object.entries(parsed.services)) {
    if (!isUnknownRecord(rawService)) {
      throw new Error(`Compose service '${serviceName}' is invalid`);
    }

    const deploy = rawService.deploy === undefined ? {} : rawService.deploy;
    if (!isUnknownRecord(deploy)) {
      throw new Error(
        `Compose service '${serviceName}' has an invalid deploy section`,
      );
    }
    rawService.deploy = deploy;

    const placement = deploy.placement === undefined ? {} : deploy.placement;
    if (!isUnknownRecord(placement)) {
      throw new Error(
        `Compose service '${serviceName}' has an invalid placement section`,
      );
    }
    deploy.placement = placement;

    const existingConstraints =
      placement.constraints === undefined ? [] : placement.constraints;
    if (
      !Array.isArray(existingConstraints) ||
      existingConstraints.some((constraint) => typeof constraint !== "string")
    ) {
      throw new Error(
        `Compose service '${serviceName}' has invalid placement constraints`,
      );
    }
    placement.constraints = existingConstraints;

    for (const constraint of constraints) {
      if (!existingConstraints.includes(constraint)) {
        existingConstraints.push(constraint);
      }
    }
  }

  return yaml.stringify(parsed);
}

function getUrlRedactions(value: string): string[] {
  const redactions = [value];
  try {
    const url = new URL(value);
    if (url.username) redactions.push(decodeURIComponent(url.username));
    if (url.password) redactions.push(decodeURIComponent(url.password));
  } catch {
    // SSH-style clone URLs are not URL-parsable; the full value is still redacted.
  }
  return redactions;
}

function followProgressWithTimeout(
  modem: {
    followProgress: (stream: any, onFinished: any, onProgress?: any) => void;
  },
  stream: NodeJS.ReadableStream,
  onProgress?: (event: {
    status?: string;
    progress?: string;
    id?: string;
  }) => void,
  timeoutMs = 120_000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timer = setTimeout(() => {
      stopReadableStream(stream);
      reject(new Error("Image pull timed out due to stream inactivity"));
    }, timeoutMs);

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stopReadableStream(stream);
        reject(new Error("Image pull timed out due to stream inactivity"));
      }, timeoutMs);
    };

    modem.followProgress(
      stream,
      (err: unknown) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      },
      (event: { status?: string; progress?: string; id?: string }) => {
        resetTimer();
        if (onProgress) onProgress(event);
      },
    );
  });
}

export class DockerService implements DockerSwarmManagementPort {
  private readonly docker: Docker;
  private readonly commandEnvironment: Record<string, string | undefined>;
  private readonly networkName = env.DOCKER_NETWORK;
  private readonly cacheDockerDiskUsage: boolean;
  private dockerDiskUsage: Record<string, unknown> | undefined;
  private dockerDiskUsageUpdatedAt = 0;
  private dockerDiskUsageRefresh: Promise<void> | undefined;
  private cancellationKey: string | null = null;
  private readonly resourceCommandBroker:
    | DockerResourceCommandBrokerPort
    | undefined;
  private readonly resourceScopedDockerFactory:
    | ResourceScopedDockerFactory
    | undefined;

  constructor(
    docker: Docker = getDockerInstance(),
    commandEnvironment: Record<string, string | undefined> = {},
    resourceCommandBroker:
      | DockerResourceCommandBrokerPort
      | undefined = createDockerResourceCommandBrokerClient(),
    resourceScopedDockerFactory?: ResourceScopedDockerFactory,
  ) {
    this.docker = docker;
    this.commandEnvironment = commandEnvironment;
    this.resourceCommandBroker = resourceCommandBroker;
    this.resourceScopedDockerFactory =
      resourceScopedDockerFactory ??
      (Object.keys(commandEnvironment).length === 0 &&
      process.env.UPSTAND_DOCKER_BROKER_CALLER?.trim() === "deployment-worker"
        ? (resourceId) =>
            getDockerInstance({ "X-Upstand-Resource-ID": resourceId })
        : undefined);
    // Remote services carry an SSH command environment and are recreated per
    // request. Cache the expensive disk-usage call for the long-lived local
    // service, while keeping remote responses complete and request-scoped.
    this.cacheDockerDiskUsage = Object.keys(commandEnvironment).length === 0;
  }

  async listServices(): Promise<DockerSelfUpdateServiceSummary[]> {
    const services = await this.docker.listServices();
    return services.flatMap((service) => {
      const id = service.ID;
      const name = service.Spec?.Name;
      return id && name ? [{ id, name }] : [];
    });
  }

  async inspectService(
    serviceId: string,
  ): Promise<DockerSelfUpdateServiceInspection> {
    const inspection = await this.docker.getService(serviceId).inspect();
    const name = inspection.Spec?.Name;
    if (!name) throw new Error(`Docker service ${serviceId} has no name`);
    return {
      version: inspection.Version?.Index ?? 0,
      name,
      taskTemplate: (inspection.Spec?.TaskTemplate ??
        {}) as unknown as DockerSelfUpdateTaskTemplate,
      updateConfig: inspection.Spec?.UpdateConfig as
        | Record<string, unknown>
        | undefined,
      rollbackConfig: inspection.Spec?.RollbackConfig as
        | Record<string, unknown>
        | undefined,
      endpointSpec: inspection.Spec?.EndpointSpec as
        | Record<string, unknown>
        | undefined,
    };
  }

  async updateService(
    serviceId: string,
    input: DockerSelfUpdateServiceUpdate,
  ): Promise<void> {
    const service = this.docker.getService(serviceId);
    await service.update({
      version: input.version,
      Name: input.name,
      TaskTemplate: input.taskTemplate,
      UpdateConfig: input.updateConfig,
      RollbackConfig: input.rollbackConfig,
      EndpointSpec: input.endpointSpec,
    } as Parameters<typeof service.update>[0]);
  }

  async removeServiceByName(
    serviceName: string,
    resourceId: string,
  ): Promise<void> {
    const normalizedServiceName = this.sanitizeName(serviceName);
    if (!normalizedServiceName || normalizedServiceName !== serviceName) {
      throw new Error("Preview service name is invalid");
    }
    if (!resourceId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(resourceId)) {
      throw new Error("Preview cleanup requires a valid resource ID");
    }

    const removeResourceService =
      this.resourceCommandBroker?.removeResourceService;
    if (removeResourceService && this.cacheDockerDiskUsage) {
      await removeResourceService(
        { kind: "local", name: "local" },
        resourceId,
        normalizedServiceName,
      );
      return;
    }

    const service = this.docker.getService(normalizedServiceName);
    const inspection = await service.inspect();
    if (inspection.Spec?.Labels?.["com.upstand.resource-id"] !== resourceId) {
      throw new Error(
        "Preview service does not belong to the requested resource",
      );
    }
    await service.remove();
  }

  async getInfo(): Promise<DockerSwarmInfoPort> {
    const info = await this.docker.info();
    return {
      localNodeState: info.Swarm?.LocalNodeState || "inactive",
      controlAvailable: info.Swarm?.ControlAvailable === true,
      nodeId: info.Swarm?.NodeID || "",
      nodeAddress: info.Swarm?.NodeAddr || "",
      nodeCount: info.Swarm?.Nodes || 0,
    };
  }

  async inspectSwarm(): Promise<DockerSwarmInspectionPort> {
    const swarm = await this.docker.swarmInspect();
    return {
      id: swarm.ID || "",
      version: swarm.Version?.Index || 0,
      createdAt: swarm.CreatedAt || null,
      updatedAt: swarm.UpdatedAt || null,
      dataPathPort: swarm.DataPathPort || null,
      defaultAddressPools: swarm.DefaultAddrPool || [],
      workerJoinToken: swarm.JoinTokens?.Worker,
      managerJoinToken: swarm.JoinTokens?.Manager,
    };
  }

  async listNodes(): Promise<DockerSwarmNodePort[]> {
    const info = await this.docker.info();
    if (info.Swarm?.LocalNodeState !== "active") return [];
    const nodes = await this.docker.listNodes();
    return nodes.map((node) => ({
      id: node.ID || "",
      hostname: node.Description?.Hostname || node.Spec?.Name || node.ID || "",
      role: node.Spec?.Role || "worker",
      labels: node.Spec?.Labels || {},
      availability: node.Spec?.Availability || "active",
      status: node.Status?.State || "unknown",
      ip: node.Status?.Addr || "",
      engineVersion: node.Description?.Engine?.EngineVersion || "unknown",
      version: node.Version?.Index || 0,
      leader: node.ManagerStatus?.Leader === true,
      managerAddr: node.ManagerStatus?.Addr || "",
      reachability: node.ManagerStatus?.Reachability || "",
      isLocalNode: node.ID === info.Swarm?.NodeID,
    }));
  }

  async listTasks(): Promise<DockerSwarmTaskPort[]> {
    const tasks = await this.docker.listTasks();
    return tasks.map((task) => ({
      id: task.ID || "",
      serviceId: task.ServiceID,
      nodeId: task.NodeID,
      slot: task.Slot || 0,
      desiredState: task.DesiredState || "unknown",
      currentState: task.Status?.State || "unknown",
      message: task.Status?.Message || task.Status?.Err || "",
      updatedAt: task.Status?.Timestamp || null,
      image: task.Spec?.ContainerSpec?.Image || "unknown",
    }));
  }

  async initialize(input: {
    advertiseAddr: string;
    dataPathAddr?: string;
    defaultAddrPools: string[];
    subnetSize: number;
  }): Promise<void> {
    await this.docker.swarmInit({
      AdvertiseAddr: input.advertiseAddr,
      ListenAddr: "0.0.0.0:2377",
      ...(input.dataPathAddr ? { DataPathAddr: input.dataPathAddr } : {}),
      DefaultAddrPool: input.defaultAddrPools,
      SubnetSize: input.subnetSize,
    });
  }

  async updateSwarm(input: {
    version: number;
    taskHistoryRetentionLimit?: number;
    rotateWorkerToken?: boolean;
    rotateManagerToken?: boolean;
  }): Promise<void> {
    await this.docker.swarmUpdate({
      version: input.version,
      ...(input.taskHistoryRetentionLimit === undefined
        ? {}
        : {
            Spec: {
              Orchestration: {
                TaskHistoryRetentionLimit: input.taskHistoryRetentionLimit,
              },
            },
          }),
      ...(input.rotateWorkerToken ? { RotateWorkerToken: true } : {}),
      ...(input.rotateManagerToken ? { RotateManagerToken: true } : {}),
    });
  }

  async inspectNode(nodeId: string): Promise<DockerSwarmNodePort> {
    const info = await this.docker.info();
    const node = await this.docker.getNode(nodeId).inspect();
    return {
      id: node.ID || nodeId,
      hostname:
        node.Description?.Hostname || node.Spec?.Name || node.ID || nodeId,
      role: node.Spec?.Role || "worker",
      labels: node.Spec?.Labels || {},
      availability: node.Spec?.Availability || "active",
      status: node.Status?.State || "unknown",
      ip: node.Status?.Addr || "",
      engineVersion: node.Description?.Engine?.EngineVersion || "unknown",
      version: node.Version?.Index || 0,
      leader: node.ManagerStatus?.Leader === true,
      managerAddr: node.ManagerStatus?.Addr || "",
      reachability: node.ManagerStatus?.Reachability || "",
      isLocalNode: node.ID === info.Swarm?.NodeID,
    };
  }

  async updateNode(
    nodeId: string,
    input: {
      version: number;
      name: string;
      labels: Record<string, string>;
      role: "manager" | "worker";
      availability: "active" | "drain" | "pause";
    },
  ): Promise<void> {
    await this.docker.getNode(nodeId).update({
      version: input.version,
      Name: input.name,
      Labels: input.labels,
      Role: input.role,
      Availability: input.availability,
    });
  }

  async removeNode(nodeId: string, force: boolean): Promise<void> {
    await this.docker.getNode(nodeId).remove({ force });
  }

  async ensureUpstandNetwork(): Promise<{ id: string; created: boolean }> {
    return ensureUpstandOverlayNetwork(this.docker);
  }

  async cleanupDocker(
    command: import("@upstand/usecases/ports/docker").DockerCleanupCommand,
    options: { preserveRollbackImages?: boolean; pruneNetworks?: boolean },
  ): Promise<void> {
    const preserveRollbackImages = options.preserveRollbackImages !== false;
    const imageFilter = preserveRollbackImages
      ? ["--filter", "label!=com.upstand.rollback.keep=true"]
      : [];
    const actions: Record<
      Exclude<
        import("@upstand/usecases/ports/docker").DockerCleanupCommand,
        "all"
      >,
      string[]
    > = {
      images: ["image", "prune", "--all", "--force", ...imageFilter],
      volumes: ["volume", "prune", "--all", "--force"],
      containers: ["container", "prune", "--force"],
      builder: ["builder", "prune", "--all", "--force"],
      system: ["system", "prune", "--all", "--force", ...imageFilter],
    };
    const commands =
      command === "all"
        ? [
            actions.containers,
            actions.images,
            actions.volumes,
            actions.builder,
            actions.system,
            ...(options.pruneNetworks ? [["network", "prune", "--force"]] : []),
          ]
        : [actions[command]];
    for (const args of commands) {
      await execFileAsync("docker", args, { maxBuffer: 2 * 1024 * 1024 });
    }
  }

  async checkGpuStatus(): Promise<
    import("@upstand/usecases/ports/docker").DockerGpuStatus
  > {
    let driverInstalled = false;
    let driverVersion: string | undefined;
    let gpuModel: string | undefined;
    let memoryInfo: string | undefined;
    let runtimeInstalled = false;
    let runtimeConfigured = false;
    let cudaSupport = false;
    let cudaVersion: string | undefined;
    let swarmEnabled = false;
    let gpuResources = 0;

    try {
      const { stdout } = await execFileAsync("nvidia-smi", [
        "--query-gpu=driver_version",
        "--format=csv,noheader",
      ]);
      driverVersion = stdout.trim();
      driverInstalled = !!driverVersion;
    } catch {}

    if (driverInstalled) {
      try {
        const { stdout } = await execFileAsync("nvidia-smi", [
          "--query-gpu=gpu_name,memory.total",
          "--format=csv,noheader",
        ]);
        const parts = stdout.split(",");
        gpuModel = parts[0]?.trim();
        memoryInfo = parts[1]?.trim();
      } catch {}
      try {
        const { stdout } = await execFileAsync("nvidia-smi", ["-q"]);
        const match = stdout.match(/CUDA Version\s*:\s*([\d.]+)/);
        if (match) {
          cudaVersion = match[1];
          cudaSupport = true;
        }
      } catch {}
    }

    try {
      await execFileAsync("sh", ["-c", "command -v nvidia-container-runtime"]);
      runtimeInstalled = true;
    } catch {}

    try {
      const info = await this.docker.info();
      runtimeConfigured = "nvidia" in (info.Runtimes || {});
    } catch {}

    try {
      const node = await this.docker.getNode("self").inspect();
      for (const resource of node.Description?.Resources?.GenericResources ||
        []) {
        const discrete = resource.DiscreteResourceSpec;
        if (
          discrete &&
          (discrete.Kind === "GPU" || discrete.Kind === "gpu") &&
          typeof discrete.Value === "number"
        ) {
          gpuResources = discrete.Value;
          swarmEnabled = true;
          break;
        }
      }
    } catch {}

    return {
      driverInstalled,
      driverVersion,
      gpuModel,
      memoryInfo,
      runtimeInstalled,
      runtimeConfigured,
      cudaSupport,
      cudaVersion,
      availableGPUs: driverInstalled ? 1 : 0,
      swarmEnabled,
      gpuResources,
    };
  }

  async setupGpuSupport(): Promise<void> {
    const status = await this.checkGpuStatus();
    if (!status.driverInstalled) {
      throw new Error(
        "NVIDIA driver not found. Please install NVIDIA drivers before configuring GPU support.",
      );
    }
    const daemonConfig = JSON.stringify(
      {
        runtimes: {
          nvidia: {
            path: "nvidia-container-runtime",
            runtimeArgs: [],
          },
        },
        "default-runtime": "nvidia",
      },
      null,
      2,
    );
    await execAsync(
      `printf '%s\\n' '${daemonConfig}' | sudo tee /etc/docker/daemon.json >/dev/null && sudo systemctl daemon-reload && sudo systemctl restart docker`,
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
  }

  async forceServiceUpdate(serviceName: string): Promise<void> {
    const service = this.docker.getService(serviceName);
    const inspection = await service.inspect();
    const taskTemplate = inspection.Spec?.TaskTemplate;
    if (!taskTemplate) {
      throw new Error(`Service ${serviceName} has no task spec`);
    }
    await service.update({
      version: inspection.Version?.Index ?? 0,
      Name: inspection.Spec?.Name ?? serviceName,
      TaskTemplate: {
        ...taskTemplate,
        ForceUpdate: (taskTemplate.ForceUpdate || 0) + 1,
      },
      Mode: inspection.Spec?.Mode,
      UpdateConfig: inspection.Spec?.UpdateConfig,
      RollbackConfig: inspection.Spec?.RollbackConfig,
      Networks: inspection.Spec?.Networks,
      EndpointSpec: inspection.Spec?.EndpointSpec,
    });
  }

  async getServiceLogs(serviceName: string, tail: number): Promise<string> {
    try {
      const stream = await this.docker.getService(serviceName).logs({
        stdout: true,
        stderr: true,
        tail,
      });
      return this.cleanDockerLogs(
        await readDockerStream(stream, MAX_WEB_SERVER_LOG_BYTES),
      );
    } catch (error: unknown) {
      if (errorStatusCode(error) !== 404) throw error;
    }

    const container = await this.findRunningServiceContainer(serviceName);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail,
    });
    return this.cleanDockerLogs(logs as Buffer);
  }

  async execServiceCommand(
    serviceName: string,
    command: readonly string[],
  ): Promise<void> {
    if (command.length === 0 || command.length > 32) {
      throw new Error(
        "Service command must contain between 1 and 32 arguments",
      );
    }
    const container = await this.findRunningServiceContainer(serviceName);
    const execution = await container.exec({
      Cmd: [...command],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await execution.start({ Detach: false });
    const timer = setTimeout(
      () => stopReadableStream(stream),
      WEB_SERVER_COMMAND_TIMEOUT_MS,
    );
    timer.unref?.();
    try {
      await readDockerStream(stream, MAX_CONTAINER_COMMAND_OUTPUT_BYTES);
      const inspection = await execution.inspect();
      if ((inspection.ExitCode ?? 0) !== 0) {
        throw new Error(
          `Service command exited with code ${inspection.ExitCode ?? 0}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async inspectNetwork(networkName: string): Promise<{
    driver: string;
    attachable: boolean;
  }> {
    const network = await this.docker.getNetwork(networkName).inspect();
    return {
      driver: network.Driver ?? "",
      attachable: network.Attachable === true,
    };
  }

  private async findRunningServiceContainer(
    serviceName: string,
  ): Promise<ReturnType<Docker["getContainer"]>> {
    const tasks = await this.docker.listTasks({
      filters: JSON.stringify({
        service: [serviceName],
        "desired-state": ["running"],
      }),
    });
    const containerId = tasks.find(
      (task) =>
        task.Status?.State === "running" &&
        task.Status?.ContainerStatus?.ContainerID,
    )?.Status?.ContainerStatus?.ContainerID;
    if (!containerId) {
      throw new Error(`No running task is available for ${serviceName}`);
    }
    return this.docker.getContainer(containerId);
  }

  setCancellationKey(key: string | null): void {
    this.cancellationKey = key;
  }

  private applyAdvancedConfig(
    resource: Resource,
    containerSpec: Record<string, unknown>,
    taskTemplate: Record<string, unknown>,
    endpointSpec: Record<string, unknown>,
    baseConstraints: string[] = [],
    serviceSpec?: Record<string, unknown>,
  ): void {
    const config = parseResourceAdvancedConfig(resource.advancedConfig);
    if (config.command.length) containerSpec.Command = config.command;
    if (config.args.length) containerSpec.Args = config.args;
    if (config.environment && Object.keys(config.environment).length) {
      const currentEnv = Array.isArray(containerSpec.Env)
        ? containerSpec.Env.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      const overrides = new Map(
        currentEnv.map((value) => {
          const split = value.indexOf("=");
          return [split === -1 ? value : value.slice(0, split), value] as const;
        }),
      );
      for (const [key, value] of Object.entries(config.environment)) {
        overrides.set(key, `${key}=${value}`);
      }
      containerSpec.Env = [...overrides.values()];
    }
    if (config.labels && Object.keys(config.labels).length) {
      containerSpec.Labels = config.labels;
    }
    if (config.volumes.length) {
      const existingMounts = Array.isArray(containerSpec.Mounts)
        ? containerSpec.Mounts
        : [];
      containerSpec.Mounts = [
        ...existingMounts,
        ...config.volumes.map((volume) => ({
          Type: "volume",
          Source: volume.source,
          Target: volume.target,
          ReadOnly: volume.readOnly,
        })),
      ];
    }
    if (config.healthcheck) {
      containerSpec.Healthcheck = {
        Test: ["CMD-SHELL", config.healthcheck.command.join(" ")],
        Interval: config.healthcheck.intervalSeconds * 1_000_000_000,
        Timeout: config.healthcheck.timeoutSeconds * 1_000_000_000,
        Retries: config.healthcheck.retries,
        StartPeriod: config.healthcheck.startPeriodSeconds * 1_000_000_000,
      };
    }
    containerSpec.Init = config.init;
    containerSpec.ReadOnly = config.readOnlyRootFilesystem;
    containerSpec.TTY = config.tty;
    containerSpec.Privileged = false;
    const securityOptions = Array.isArray(containerSpec.SecurityOpt)
      ? containerSpec.SecurityOpt.filter(
          (option): option is string => typeof option === "string",
        )
      : [];
    if (!securityOptions.includes("no-new-privileges:true")) {
      securityOptions.push("no-new-privileges:true");
    }
    containerSpec.SecurityOpt = securityOptions;
    const droppedCapabilities = Array.isArray(containerSpec.CapDrop)
      ? containerSpec.CapDrop.filter(
          (capability): capability is string => typeof capability === "string",
        )
      : [];
    if (!droppedCapabilities.includes("ALL")) droppedCapabilities.push("ALL");
    containerSpec.CapDrop = droppedCapabilities;
    if (config.stopGracePeriodSeconds !== undefined) {
      containerSpec.StopGracePeriod =
        config.stopGracePeriodSeconds * 1_000_000_000;
    }
    if (config.workingDir) containerSpec.Dir = config.workingDir;
    if (config.user) containerSpec.User = config.user;
    if (config.hostname) containerSpec.Hostname = config.hostname;
    if (config.dns.length) containerSpec.DNS = config.dns;
    if (config.dnsSearch.length) containerSpec.DNSSearch = config.dnsSearch;
    if (config.extraHosts.length) containerSpec.Hosts = config.extraHosts;
    if (Object.keys(config.sysctls).length)
      containerSpec.Sysctls = config.sysctls;
    if (config.capDrop.length) {
      for (const capability of config.capDrop) {
        if (!droppedCapabilities.includes(capability)) {
          droppedCapabilities.push(capability);
        }
      }
      containerSpec.CapDrop = droppedCapabilities;
    }

    const resources = config.resources;
    if (resources.cpuLimit || resources.memoryLimitMb) {
      taskTemplate.Resources = {
        ...(taskTemplate.Resources as Record<string, unknown> | undefined),
        Limits: {
          ...(resources.cpuLimit
            ? { NanoCPUs: Math.round(resources.cpuLimit * 1_000_000_000) }
            : {}),
          ...(resources.memoryLimitMb
            ? { MemoryBytes: resources.memoryLimitMb * 1024 * 1024 }
            : {}),
        },
      };
    }
    if (resources.cpuReservation || resources.memoryReservationMb) {
      taskTemplate.Resources = {
        ...(taskTemplate.Resources as Record<string, unknown> | undefined),
        Reservations: {
          ...(resources.cpuReservation
            ? { NanoCPUs: Math.round(resources.cpuReservation * 1_000_000_000) }
            : {}),
          ...(resources.memoryReservationMb
            ? { MemoryBytes: resources.memoryReservationMb * 1024 * 1024 }
            : {}),
        },
      };
    }

    const restart = config.restartPolicy;
    taskTemplate.RestartPolicy = {
      Condition: restart.condition,
      ...(restart.maxAttempts ? { MaxAttempts: restart.maxAttempts } : {}),
      ...(restart.delaySeconds
        ? { Delay: restart.delaySeconds * 1_000_000_000 }
        : {}),
      ...(restart.windowSeconds
        ? { Window: restart.windowSeconds * 1_000_000_000 }
        : {}),
    };
    const constraints = [...baseConstraints, ...config.placementConstraints];
    if (constraints.length) {
      taskTemplate.Placement = {
        ...(taskTemplate.Placement as Record<string, unknown> | undefined),
        Constraints: [...new Set(constraints)],
      };
    }
    if (config.replicas !== undefined) {
      (serviceSpec ?? taskTemplate).Mode = {
        Replicated: { Replicas: config.replicas },
      };
    }
    const toDuration = (seconds?: number) =>
      seconds === undefined ? undefined : seconds * 1_000_000_000;
    const serviceConfig = (serviceSpec ?? taskTemplate) as Record<
      string,
      unknown
    >;
    const update = config.updateConfig;
    const strategy = config.deploymentStrategy;
    if (strategy.type === "canary") {
      serviceConfig.UpdateConfig = {
        ...(serviceConfig.UpdateConfig as Record<string, unknown> | undefined),
        Parallelism: strategy.canaryReplicas ?? update.parallelism ?? 1,
        FailureAction: "pause",
        Monitor: (strategy.bakeTimeSeconds ?? 60) * 1_000_000_000,
        Order: "start-first",
      };
    } else if (strategy.type === "progressive") {
      serviceConfig.UpdateConfig = {
        ...(serviceConfig.UpdateConfig as Record<string, unknown> | undefined),
        Parallelism: 1,
        FailureAction: strategy.automaticRollback ? "rollback" : "pause",
        Monitor: (strategy.bakeTimeSeconds ?? 60) * 1_000_000_000,
        Order: "start-first",
      };
    } else if (strategy.type === "blue-green") {
      serviceConfig.UpdateConfig = {
        ...(serviceConfig.UpdateConfig as Record<string, unknown> | undefined),
        Parallelism: config.replicas ?? 1,
        FailureAction: strategy.automaticRollback ? "rollback" : "pause",
        Monitor: (strategy.bakeTimeSeconds ?? 60) * 1_000_000_000,
        Order: "start-first",
      };
    }
    if (Object.keys(update).length) {
      const updateConfig = {
        ...update,
        ...(toDuration(update.delaySeconds) !== undefined
          ? { Delay: toDuration(update.delaySeconds) }
          : {}),
        ...(toDuration(update.monitorSeconds) !== undefined
          ? { Monitor: toDuration(update.monitorSeconds) }
          : {}),
      } as Record<string, unknown>;
      delete updateConfig.delaySeconds;
      delete updateConfig.monitorSeconds;
      serviceConfig.UpdateConfig = {
        ...(serviceConfig.UpdateConfig as Record<string, unknown> | undefined),
        ...updateConfig,
      };
    }
    const rollback = config.rollbackConfig;
    if (Object.keys(rollback).length) {
      const rollbackConfig = {
        ...rollback,
        ...(toDuration(rollback.delaySeconds) !== undefined
          ? { Delay: toDuration(rollback.delaySeconds) }
          : {}),
        ...(toDuration(rollback.monitorSeconds) !== undefined
          ? { Monitor: toDuration(rollback.monitorSeconds) }
          : {}),
      } as Record<string, unknown>;
      delete rollbackConfig.delaySeconds;
      delete rollbackConfig.monitorSeconds;
      serviceConfig.RollbackConfig = rollbackConfig;
    }
    if (config.ports.length) {
      endpointSpec.Ports = [
        ...(Array.isArray(endpointSpec.Ports) ? endpointSpec.Ports : []),
        ...config.ports.map((port) => ({
          Protocol: port.protocol,
          PublishedPort: port.publishedPort,
          TargetPort: port.targetPort,
          PublishMode: "ingress",
        })),
      ];
    }
  }

  public sanitizeName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]/g, "-");
  }

  async initializeSwarm(targetDocker?: Docker): Promise<void> {
    const docker = targetDocker || this.docker;
    let info = await docker.info();
    if (!isSwarmActive(info)) {
      if (env.NODE_ENV === "development") {
        try {
          await docker.swarmInit({
            AdvertiseAddr: "127.0.0.1",
            ListenAddr: "0.0.0.0:2377",
          });
          info = await docker.info();
        } catch (error) {
          throw new ConflictError(
            `Docker Swarm is inactive and auto-initialization failed: ${
              error instanceof Error ? error.message : String(error)
            }. Please initialize a cluster manually before managing it.`,
          );
        }
      } else {
        throw new ConflictError(
          "Docker Swarm is inactive. Initialize it from the Docker Swarm dashboard with a routable advertise address before deploying resources.",
        );
      }
    }
    if (!isManager(info)) {
      throw new ConflictError(
        "This Upstand instance is attached to a Swarm worker. Deployments must run through a reachable manager Docker API.",
      );
    }
  }

  async ensureNetwork(targetDocker?: Docker): Promise<string> {
    await this.initializeSwarm(targetDocker);
    const docker = targetDocker || this.docker;
    const network = await ensureUpstandOverlayNetwork(docker);
    return network.id;
  }

  private async ensureDeploymentNetwork(
    resource: Resource,
    targetDocker?: DockerApiTarget,
  ): Promise<{
    id: string;
    name: string;
    isolated: boolean;
  }> {
    const docker = targetDocker
      ? requireDockerTarget(targetDocker)
      : (this.resourceScopedDockerFactory?.(resource.id) ?? this.docker);
    const isolated = parseResourceAdvancedConfig(
      resource.advancedConfig,
    ).isolatedDeployment;
    if (isolated) {
      const ensureTypedResourceNetwork =
        !targetDocker && this.resourceCommandBroker?.ensureResourceNetwork;
      if (ensureTypedResourceNetwork) {
        return {
          ...(await ensureTypedResourceNetwork(
            { kind: "local", name: "local" },
            resource.id,
          )),
          isolated: true,
        };
      }
      const network = await ensureResourceOverlayNetwork(docker, resource.id);
      return { ...network, isolated: true };
    }

    if (!targetDocker && this.resourceCommandBroker?.ensureUpstandNetwork) {
      return {
        ...(await this.resourceCommandBroker.ensureUpstandNetwork()),
        name: this.networkName,
        isolated: false,
      };
    }

    return {
      id: await this.ensureNetwork(docker),
      name: this.networkName,
      isolated: false,
    };
  }

  async deployDatabase(
    resource: Resource,
    envVars: Record<string, string>,
    onLog?: (log: string) => void,
    constraints?: string[],
  ): Promise<void> {
    const serviceName = this.sanitizeName(resource.appName || resource.name);
    const networkId = (await this.ensureDeploymentNetwork(resource)).id;

    let image = "";
    let targetPath = "";
    const ports: number[] = [];
    const defaultEnv: Record<string, string> = {};

    const dbType = resource.dbType?.toLowerCase() || "";
    if (dbType === "postgres") {
      image =
        resource.dockerImage &&
        isSupportedDatabaseImage(dbType, resource.dockerImage, true)
          ? resource.dockerImage
          : "postgres:18-alpine";
      targetPath = envVars.PGDATA || "/var/lib/postgresql/18/docker";
      ports.push(5432);
      defaultEnv.POSTGRES_USER = envVars.POSTGRES_USER || "upstand";
      defaultEnv.POSTGRES_DB = envVars.POSTGRES_DB || "upstand";
    } else if (dbType === "mysql" || dbType === "mariadb") {
      image =
        resource.dockerImage &&
        isSupportedDatabaseImage(dbType, resource.dockerImage, true)
          ? resource.dockerImage
          : dbType === "mysql"
            ? "mysql:8.0"
            : "mariadb:11";
      targetPath = "/var/lib/mysql";
      ports.push(3306);
      defaultEnv.MYSQL_DATABASE = envVars.MYSQL_DATABASE || "upstand";
      defaultEnv.MYSQL_USER = envVars.MYSQL_USER || "upstand";
    } else if (dbType === "mongodb") {
      image =
        resource.dockerImage &&
        isSupportedDatabaseImage(dbType, resource.dockerImage, true)
          ? resource.dockerImage
          : "mongo:7.0";
      targetPath = "/data/db";
      ports.push(27017);
      defaultEnv.MONGO_INITDB_ROOT_USERNAME =
        envVars.MONGO_INITDB_ROOT_USERNAME || "upstand";
    } else if (dbType === "redis") {
      image =
        resource.dockerImage &&
        isSupportedDatabaseImage(dbType, resource.dockerImage, true)
          ? resource.dockerImage
          : "redis:8.8-alpine";
      targetPath = "/data";
      ports.push(6379);
    } else if (dbType === "libsql") {
      image =
        resource.dockerImage &&
        isSupportedDatabaseImage(dbType, resource.dockerImage, true)
          ? resource.dockerImage
          : "ghcr.io/tursodatabase/libsql-server:0.24.32";
      targetPath = "/var/lib/sqld";
      ports.push(
        LIBSQL_CONTAINER_PORTS.http,
        LIBSQL_CONTAINER_PORTS.grpc,
        LIBSQL_CONTAINER_PORTS.admin,
      );
    } else {
      throw new Error(`Unsupported database type: ${dbType}`);
    }

    const replicationConfig = parseResourceAdvancedConfig(
      resource.advancedConfig,
    ).databaseReplication;
    if (
      dbType === "postgres" &&
      replicationConfig.enabled &&
      !image.toLowerCase().includes("bitnami/postgresql-repmgr")
    ) {
      throw new ConflictError(
        "Managed PostgreSQL replication requires the bitnami/postgresql-repmgr image",
      );
    }

    if (onLog) onLog(`Pulling database image: ${image}...\n`);
    const scopedDocker =
      this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;
    try {
      const pullResourceImage = this.resourceCommandBroker?.pullResourceImage;
      if (pullResourceImage && this.cacheDockerDiskUsage) {
        await pullResourceImage(
          { kind: "local", name: "local" },
          resource.id,
          image,
        );
      } else {
        const stream = await scopedDocker.pull(image);
        await followProgressWithTimeout(scopedDocker.modem, stream, (event) => {
          if (onLog && event) {
            const status = event.status || "";
            const progress = event.progress ? ` ${event.progress}` : "";
            const id = event.id ? ` [${event.id}]` : "";
            onLog(`${status}${progress}${id}\n`);
          }
        });
      }
    } catch (err: unknown) {
      const message = `Failed to pull database image: ${errorMessage(err)}`;
      if (onLog) onLog(`${message}\n`);
      throw new Error(message, { cause: err });
    }

    const mergedEnv = { ...defaultEnv, ...envVars };
    assertManagedDatabaseCredentials(dbType, mergedEnv);
    if (dbType === "postgres" && replicationConfig.enabled) {
      const primaryName = this.sanitizeName(resource.appName || resource.name);
      const password =
        mergedEnv.POSTGRES_PASSWORD || mergedEnv.POSTGRESQL_PASSWORD || "";
      Object.assign(mergedEnv, {
        POSTGRESQL_POSTGRES_PASSWORD:
          mergedEnv.POSTGRES_POSTGRES_PASSWORD || password,
        POSTGRESQL_USERNAME: mergedEnv.POSTGRES_USER || "upstand",
        POSTGRESQL_PASSWORD: password,
        POSTGRESQL_DATABASE: mergedEnv.POSTGRES_DB || "upstand",
        POSTGRESQL_REPLICATION_MODE: "master",
        REPMGR_USERNAME: replicationConfig.replicationUser,
        REPMGR_PASSWORD: mergedEnv.REPMGR_PASSWORD || password,
        REPMGR_PRIMARY_HOST: primaryName,
        REPMGR_PRIMARY_PORT: "5432",
        REPMGR_PARTNER_NODES: `${primaryName}:5432,${primaryName}-replica:5432`,
        REPMGR_NODE_NAME: primaryName,
        REPMGR_NODE_NETWORK_NAME: primaryName,
        REPMGR_FAILOVER: replicationConfig.automaticFailover
          ? "automatic"
          : "manual",
      });
    }
    const envArray = Object.entries(mergedEnv).map(([k, v]) => `${k}=${v}`);
    const volumeName = `upstand-db-data-${resource.id}`;

    const containerSpec: MutableContainerSpec = {
      Image: image,
      Env: envArray,
      Mounts: [
        {
          Type: "volume",
          Source: volumeName,
          Target: targetPath,
        },
      ],
    };

    if (dbType === "redis") {
      const redisPassword = envVars.REDIS_PASSWORD || "";
      if (redisPassword) {
        containerSpec.Command = [
          "redis-server",
          "--requirepass",
          redisPassword,
        ];
      }
    }

    if (dbType === "libsql") {
      containerSpec.Command = ["/bin/sh"];
      containerSpec.Args = [
        "-c",
        `sqld --db-path /var/lib/sqld/iku.db --http-listen-addr 0.0.0.0:${LIBSQL_CONTAINER_PORTS.http} --grpc-listen-addr 0.0.0.0:${LIBSQL_CONTAINER_PORTS.grpc} --admin-listen-addr 0.0.0.0:${LIBSQL_CONTAINER_PORTS.admin}`,
      ];
    }

    const publishedPortForTarget = (targetPort: number): number | undefined => {
      if (dbType === "libsql") {
        if (targetPort === 8080 && resource.externalPort) {
          return resource.externalPort;
        }
        if (targetPort === 5001 && resource.libsqlGrpcPort) {
          return resource.libsqlGrpcPort;
        }
        if (targetPort === 5000 && resource.libsqlAdminPort) {
          return resource.libsqlAdminPort;
        }
        return undefined;
      }
      return resource.externalPort ? resource.externalPort : undefined;
    };

    const publishedPorts: Docker.PortConfig[] = ports
      .map((p) => {
        const pub = publishedPortForTarget(p);
        if (!pub) return null;
        return {
          Protocol: "tcp" as const,
          PublishedPort: pub,
          TargetPort: p,
          PublishMode: "ingress" as const,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    const spec: Docker.CreateServiceOptions = {
      Name: serviceName,
      Labels: { "com.upstand.resource-id": resource.id },
      TaskTemplate: {
        ContainerSpec: containerSpec,
        RestartPolicy: {
          Condition: "any",
        },
        Placement: constraints ? { Constraints: constraints } : undefined,
        Networks: [{ Target: networkId }],
      },
      ...(publishedPorts.length > 0
        ? {
            EndpointSpec: {
              Ports: publishedPorts,
            },
          }
        : {}),
    };

    const endpointSpec = spec.EndpointSpec || {};
    spec.EndpointSpec = endpointSpec;
    this.applyAdvancedConfig(
      resource,
      containerSpec,
      spec.TaskTemplate as Record<string, unknown>,
      spec.EndpointSpec as Record<string, unknown>,
      constraints,
      spec as Record<string, unknown>,
    );

    await this.upsertService(
      serviceName,
      spec,
      undefined,
      undefined,
      resource.id,
    );
    await this.ensureServiceNetwork(
      serviceName,
      networkId,
      undefined,
      resource.id,
    );
  }

  async deployAppImage(
    resource: Resource,
    envVars: Record<string, string>,
    onLog?: (log: string) => void,
    constraints?: string[],
    registryAuth?: {
      username?: string;
      password?: string;
      serveraddress?: string;
    },
    revision?: DeploymentRevisionOptions,
  ): Promise<void> {
    const serviceName = this.sanitizeName(
      revision?.serviceNameOverride || resource.appName || resource.name,
    );
    const networkId = (await this.ensureDeploymentNetwork(resource)).id;

    if (!resource.dockerImage) {
      throw new Error("No Docker image specified for application resource");
    }

    if (onLog) onLog(`Pulling application image: ${resource.dockerImage}...\n`);
    const scopedDocker =
      this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;
    try {
      const pullResourceImage = this.resourceCommandBroker?.pullResourceImage;
      const typedRegistryAuth =
        registryAuth?.username && registryAuth.password
          ? {
              username: registryAuth.username,
              password: registryAuth.password,
              ...(registryAuth.serveraddress
                ? { serveraddress: registryAuth.serveraddress }
                : {}),
            }
          : undefined;
      if (
        pullResourceImage &&
        this.cacheDockerDiskUsage &&
        (!registryAuth || typedRegistryAuth)
      ) {
        await pullResourceImage(
          { kind: "local", name: "local" },
          resource.id,
          resource.dockerImage,
          typedRegistryAuth,
        );
      } else {
        const stream = await scopedDocker.pull(resource.dockerImage, {
          ...(registryAuth ? { authconfig: registryAuth } : {}),
        });
        await followProgressWithTimeout(scopedDocker.modem, stream, (event) => {
          if (onLog && event) {
            const status = event.status || "";
            const progress = event.progress ? ` ${event.progress}` : "";
            const id = event.id ? ` [${event.id}]` : "";
            onLog(`${status}${progress}${id}\n`);
          }
        });
      }
    } catch (err: unknown) {
      const message = `Failed to pull image: ${errorMessage(err)}`;
      if (onLog) onLog(`${message}\n`);
      throw new Error(message, { cause: err });
    }

    const envArray = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);

    const spec: Docker.CreateServiceOptions = {
      Name: serviceName,
      Labels: {
        "com.upstand.resource-id": resource.id,
        ...(revision?.serviceNameOverride
          ? { "com.upstand.deployment-revision": "true" }
          : {}),
      },
      TaskTemplate: {
        ContainerSpec: {
          Image: resource.dockerImage,
          Env: envArray,
        },
        RestartPolicy: {
          Condition: "any",
        },
        Placement: constraints ? { Constraints: constraints } : undefined,
        Networks: [{ Target: networkId }],
      },
    };

    const endpointSpec = spec.EndpointSpec || {};
    spec.EndpointSpec = endpointSpec;
    this.applyAdvancedConfig(
      resource,
      (spec.TaskTemplate as { ContainerSpec?: Record<string, unknown> })
        .ContainerSpec as Record<string, unknown>,
      spec.TaskTemplate as Record<string, unknown>,
      endpointSpec as Record<string, unknown>,
      constraints,
      spec as Record<string, unknown>,
    );
    if (revision?.replicasOverride !== undefined) {
      (spec as Record<string, unknown>).Mode = {
        Replicated: { Replicas: revision.replicasOverride },
      };
    }

    await this.upsertService(
      serviceName,
      spec,
      registryAuth,
      undefined,
      resource.id,
    );
    await this.ensureServiceNetwork(
      serviceName,
      networkId,
      undefined,
      resource.id,
    );
  }

  async deployAppGit(
    resource: Resource,
    envVars: Record<string, string>,
    cloneUrl: string,
    onLog: (log: string) => void,
    sshKeyPath?: string,
    constraints?: string[],
    registryInfo?: {
      url: string;
      username?: string;
      password?: string;
      imageTag: string;
    },
    destinationDocker?: DockerApiTarget,
    sourceRevision?: string,
    onGitCloned?: (clonePath: string) => Promise<Resource | undefined>,
    revision?: DeploymentRevisionOptions,
    buildEnvVars?: Record<string, string>,
    gitEnvironment?: Record<string, string>,
    sshHostKeyFingerprint?: string,
    onBuildResolved?: (artifact: ResolvedBuildArtifact) => Promise<void>,
  ): Promise<void> {
    let currentResource = resource;
    const serviceName = this.sanitizeName(
      revision?.serviceNameOverride ||
        currentResource.appName ||
        currentResource.name,
    );
    const imageName = `upstand-app-${currentResource.id}:${normalizeBuildImageTag(revision?.imageTagSuffix)}`;
    const buildImageName = registryInfo ? registryInfo.imageTag : imageName;
    const networkId = (
      await this.ensureDeploymentNetwork(currentResource, destinationDocker)
    ).id;

    const buildDir = path.join(process.cwd(), ".builds");
    const clonePath = path.join(buildDir, currentResource.id);
    const sourceConfig = parseResourceAdvancedConfig(
      currentResource.advancedConfig,
    ).source;
    let cleanupSourceEnvironment: (() => void) | undefined;

    if (currentResource.provider === "drop") {
      const dropsDir = path.join(
        process.cwd(),
        ".builds",
        "drops",
        currentResource.id,
      );
      if (!fs.existsSync(dropsDir)) {
        throw new Error(
          "ZIP drop folder not found. Please upload the ZIP file first.",
        );
      }
      if (fs.existsSync(clonePath)) {
        onLog("Cleaning up old workspace directory...\n");
        fs.rmSync(clonePath, { recursive: true, force: true });
      }
      fs.mkdirSync(clonePath, { recursive: true });
      onLog("Copying files from uploaded ZIP payload...\n");
      fs.cpSync(dropsDir, clonePath, { recursive: true });
    } else {
      let branch = "main";
      let submodules = false;
      try {
        if (currentResource.credentials) {
          const config: unknown = parseResourceCredentials(
            currentResource.credentials,
          );
          if (isUnknownRecord(config)) {
            const configuredBranch = config.branch;
            branch =
              typeof configuredBranch === "string" && configuredBranch.trim()
                ? configuredBranch.trim()
                : branch;
            submodules = config.enableSubmodules === true;
          }
        }
      } catch {
        // Credentials are optional for direct Git providers; defaults remain safe.
      }

      assertSafeGitUrl(cloneUrl);
      await assertSafeGitNetworkUrl(cloneUrl);
      let sourceEnvironment: NodeJS.ProcessEnv | undefined;
      if (isSshGitUrl(cloneUrl)) {
        if (!sshHostKeyFingerprint) {
          throw new Error(
            "SSH Git deployments require a pinned host-key fingerprint",
          );
        }
        const pinned = await createPinnedGitSshEnvironment(
          cloneUrl,
          sshHostKeyFingerprint,
          sshKeyPath,
          gitEnvironment,
          sourceConfig.timeoutSeconds * 1_000,
        );
        sourceEnvironment = pinned.environment;
        cleanupSourceEnvironment = pinned.cleanup;
      } else if (sshKeyPath || gitEnvironment) {
        sourceEnvironment = {
          ...getInheritedEnv(),
          ...(gitEnvironment ?? {}),
          ...(sshKeyPath
            ? {
                GIT_SSH_COMMAND: `ssh -i "${sshKeyPath}" -o IdentitiesOnly=yes`,
              }
            : {}),
        };
      }
      try {
        await this.prepareGitWorkspace(
          clonePath,
          cloneUrl,
          branch,
          sourceRevision,
          sourceConfig,
          onLog,
          sourceEnvironment,
        );

        if (submodules) {
          onLog("Initializing submodules...\n");
          await this.runCommandAsync(
            "git",
            ["-C", clonePath, "submodule", "update", "--init", "--recursive"],
            onLog,
            sourceEnvironment,
            { timeoutMs: sourceConfig.timeoutSeconds * 1_000 },
          );
        }
      } catch (error) {
        cleanupSourceEnvironment?.();
        throw error;
      }
    }

    if (onGitCloned) {
      const refreshedResource = await onGitCloned(clonePath);
      if (refreshedResource) {
        currentResource = refreshedResource;
      }
    }

    try {
      let detectorVersion: string | null = null;
      let buildConfig = parseApplicationBuildConfig(
        currentResource.buildConfig,
      );

      if (buildConfig.autoDetect !== false) {
        const detection = detectBuildConfig(clonePath, buildConfig.buildPath);
        if (detection.status !== "detected" || !detection.config) {
          throw new Error(detection.warnings.join(" "));
        }
        detectorVersion = detection.detectorVersion;
        onLog(
          `[Auto-Detect] Detected '${detection.config.type}' (${detection.framework ?? detection.language ?? "repository configuration"}, confidence ${detection.confidence.toFixed(2)}). Evidence: ${detection.evidence.map((item) => item.file).join(", ")}.\n`,
        );
        for (const warning of detection.warnings) {
          onLog(`[Auto-Detect] Warning: ${warning}\n`);
        }
        buildConfig = detection.config;
      }

      const buildPath = this.resolveBuildPath(
        clonePath,
        buildConfig.buildPath,
        "Build path",
      );
      const resolvedBuildEnvironment = buildEnvVars ?? envVars;
      const applicationBuildSecrets =
        getApplicationBuildSecrets(currentResource);
      const typedBuildEligible =
        buildConfig.type === "dockerfile" &&
        Object.keys(this.commandEnvironment).length === 0 &&
        Object.keys(applicationBuildSecrets).length === 0;
      await this.buildApplicationImage(
        currentResource.id,
        buildPath,
        buildImageName,
        buildConfig,
        resolvedBuildEnvironment,
        onLog,
        applicationBuildSecrets,
        currentResource.rollbackActive === true,
      );

      if (registryInfo) {
        const pushResourceImage = this.resourceCommandBroker?.pushResourceImage;
        if (
          typedBuildEligible &&
          (destinationDocker === undefined ||
            destinationDocker === this.docker) &&
          Object.keys(this.commandEnvironment).length === 0 &&
          registryInfo.username &&
          registryInfo.password &&
          pushResourceImage
        ) {
          onLog(
            `Pushing image to registry through the typed Docker broker: ${registryInfo.imageTag}...\n`,
          );
          await pushResourceImage(
            { kind: "local", name: "local" },
            currentResource.id,
            registryInfo.imageTag,
            {
              username: registryInfo.username,
              password: registryInfo.password,
              serveraddress: registryInfo.url,
            },
          );
        } else {
          if (registryInfo.username && registryInfo.password) {
            onLog(`Logging into Docker registry: ${registryInfo.url}...\n`);
            await this.runCommandAsync(
              "docker",
              [
                "login",
                "--username",
                registryInfo.username,
                "--password-stdin",
                registryInfo.url,
              ],
              onLog,
              undefined,
              {
                stdin: `${registryInfo.password}\n`,
                redactions: [registryInfo.password],
              },
            );
          }
          onLog(`Pushing image to registry: ${registryInfo.imageTag}...\n`);
          await this.runCommandAsync(
            "docker",
            ["push", registryInfo.imageTag],
            onLog,
          );
        }
      } else if (destinationDocker && destinationDocker !== this.docker) {
        await this.transferImage(buildImageName, destinationDocker, onLog);
      }

      let immutableImageReference = buildImageName;
      if (onBuildResolved) {
        const buildDocker =
          this.resourceScopedDockerFactory?.(currentResource.id) ?? this.docker;
        const inspectedImage = await buildDocker
          .getImage(buildImageName)
          .inspect();
        const imageId = inspectedImage.Id;
        if (!/^sha256:[0-9a-f]{64}$/.test(imageId)) {
          throw new Error(
            "Built image did not expose an immutable SHA-256 identity",
          );
        }
        const sourceIdentity =
          sourceRevision?.trim() || this.resolveGitHead(clonePath);
        const configurationVersion = `sha256:${createHash("sha256")
          .update(JSON.stringify(buildConfig))
          .digest("hex")}`;
        const registryDigest = inspectedImage.RepoDigests?.find((reference) =>
          reference.includes("@sha256:"),
        );
        immutableImageReference = registryDigest ?? imageId;
        const digest = registryDigest?.split("@").at(-1) ?? imageId;
        if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
          throw new Error("Resolved deployment artifact digest is invalid");
        }
        await onBuildResolved({
          buildConfig,
          detectorVersion,
          sourceRevision: sourceIdentity,
          configurationVersion,
          digest,
          reference: immutableImageReference,
        });
      }

      onLog("Deploying Swarm Service...\n");
      const envArray = Object.entries(envVars).map(
        ([key, value]) => `${key}=${value}`,
      );
      const runtimeCommand = this.getRuntimeCommand(clonePath);

      const spec: Docker.CreateServiceOptions = {
        Name: serviceName,
        Labels: {
          "com.upstand.resource-id": currentResource.id,
          ...(revision?.serviceNameOverride
            ? { "com.upstand.deployment-revision": "true" }
            : {}),
        },
        TaskTemplate: {
          ContainerSpec: {
            Image: immutableImageReference,
            Env: envArray,
            ...(runtimeCommand ? { Command: runtimeCommand } : {}),
          },
          RestartPolicy: {
            Condition: "any",
          },
          Placement: constraints ? { Constraints: constraints } : undefined,
          Networks: [{ Target: networkId }],
        },
      };

      const endpointSpec = spec.EndpointSpec || {};
      spec.EndpointSpec = endpointSpec;
      this.applyAdvancedConfig(
        currentResource,
        (spec.TaskTemplate as { ContainerSpec?: Record<string, unknown> })
          .ContainerSpec as Record<string, unknown>,
        spec.TaskTemplate as Record<string, unknown>,
        endpointSpec as Record<string, unknown>,
        constraints,
        spec as Record<string, unknown>,
      );
      if (revision?.replicasOverride !== undefined) {
        (spec as Record<string, unknown>).Mode = {
          Replicated: { Replicas: revision.replicasOverride },
        };
      }

      const authConfig =
        registryInfo?.username && registryInfo.password
          ? {
              username: registryInfo.username,
              password: registryInfo.password,
              serveraddress: registryInfo.url,
            }
          : undefined;

      await this.upsertService(
        serviceName,
        spec,
        authConfig,
        destinationDocker,
        currentResource.id,
      );
      await this.ensureServiceNetwork(
        serviceName,
        networkId,
        destinationDocker,
        currentResource.id,
      );
    } finally {
      cleanupSourceEnvironment?.();
      onLog("Cleaning up build directory...\n");
      if (!sourceConfig.reuseWorkspace) {
        fs.rmSync(clonePath, { recursive: true, force: true });
      }
    }
  }

  private resolveGitHead(clonePath: string): string {
    const result = Bun.spawnSync({
      cmd: ["git", "-C", clonePath, "rev-parse", "HEAD"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const revision = result.success
      ? new TextDecoder().decode(result.stdout).trim()
      : "";
    if (!/^[0-9a-f]{40,64}$/i.test(revision)) {
      throw new Error("Unable to resolve the immutable source revision");
    }
    return revision;
  }

  async readComposeFileFromGit(
    resource: Resource,
    cloneUrl: string,
    onLog: (log: string) => void,
    sshKeyPath?: string,
    sourceRevision?: string,
    gitEnvironment?: Record<string, string>,
    sshHostKeyFingerprint?: string,
  ): Promise<string> {
    const buildDir = path.join(process.cwd(), ".builds");
    const clonePath = path.join(buildDir, `${resource.id}-compose`);
    const sourceConfig = parseResourceAdvancedConfig(
      resource.advancedConfig,
    ).source;
    if (!sourceConfig.reuseWorkspace) {
      fs.rmSync(clonePath, { recursive: true, force: true });
    }
    fs.mkdirSync(buildDir, { recursive: true });

    let branch = "main";
    let composePath = "docker-compose.yml";
    let submodules = false;
    try {
      const config: unknown = parseResourceCredentials(resource.credentials);
      if (isUnknownRecord(config)) {
        if (typeof config.branch === "string" && config.branch.trim()) {
          branch = config.branch.trim();
        }
        if (
          typeof config.composePath === "string" &&
          config.composePath.trim()
        ) {
          composePath = config.composePath.trim();
        }
        submodules = config.enableSubmodules === true;
      }
    } catch {
      // Defaults are safe when optional source metadata is malformed.
    }

    let sshEnvironment: NodeJS.ProcessEnv | undefined;
    let cleanupSshEnvironment: (() => void) | undefined;
    try {
      assertSafeGitUrl(cloneUrl);
      await assertSafeGitNetworkUrl(cloneUrl);
      if (isSshGitUrl(cloneUrl)) {
        if (!sshHostKeyFingerprint) {
          throw new Error(
            "SSH Git deployments require a pinned host-key fingerprint",
          );
        }
        const pinned = await createPinnedGitSshEnvironment(
          cloneUrl,
          sshHostKeyFingerprint,
          sshKeyPath,
          gitEnvironment,
          sourceConfig.timeoutSeconds * 1_000,
        );
        sshEnvironment = pinned.environment;
        cleanupSshEnvironment = pinned.cleanup;
      } else if (sshKeyPath || gitEnvironment) {
        sshEnvironment = {
          ...getInheritedEnv(),
          ...(gitEnvironment ?? {}),
          ...(sshKeyPath
            ? {
                GIT_SSH_COMMAND: `ssh -i "${sshKeyPath}" -o IdentitiesOnly=yes`,
              }
            : {}),
        };
      }
      await this.prepareGitWorkspace(
        clonePath,
        cloneUrl,
        branch,
        sourceRevision,
        sourceConfig,
        onLog,
        sshEnvironment,
      );
      if (submodules) {
        await this.runCommandAsync(
          "git",
          ["-C", clonePath, "submodule", "update", "--init", "--recursive"],
          onLog,
          sshEnvironment,
          { timeoutMs: sourceConfig.timeoutSeconds * 1_000 },
        );
      }

      const resolvedComposePath = path.resolve(clonePath, composePath);
      const cloneRoot = `${path.resolve(clonePath)}${path.sep}`;
      if (!resolvedComposePath.startsWith(cloneRoot)) {
        throw new Error(
          "Compose path must stay inside the checked-out repository",
        );
      }
      if (!fs.existsSync(resolvedComposePath)) {
        throw new Error(`Compose file not found at '${composePath}'`);
      }
      return fs.readFileSync(resolvedComposePath, "utf8");
    } finally {
      cleanupSshEnvironment?.();
      if (!sourceConfig.reuseWorkspace) {
        fs.rmSync(clonePath, { recursive: true, force: true });
      }
    }
  }

  private async checkoutSourceRevision(
    clonePath: string,
    sourceRevision: string,
    onLog: (log: string) => void,
    environment?: NodeJS.ProcessEnv,
    timeoutMs?: number,
  ): Promise<void> {
    if (!/^[0-9a-f]{7,64}$/i.test(sourceRevision)) {
      throw new Error("Deployment source revision is not a valid commit SHA");
    }
    onLog(`Checking out source revision ${sourceRevision}...\n`);
    await this.runCommandAsync(
      "git",
      [
        "-C",
        clonePath,
        "fetch",
        "--depth",
        "1",
        "origin",
        "--",
        sourceRevision,
      ],
      onLog,
      environment,
      { timeoutMs },
    );
    await this.runCommandAsync(
      "git",
      ["-C", clonePath, "checkout", "--detach", "--", sourceRevision],
      onLog,
      environment,
      { timeoutMs },
    );
  }

  private async prepareGitWorkspace(
    clonePath: string,
    cloneUrl: string,
    branch: string,
    sourceRevision: string | undefined,
    sourceConfig: ResourceAdvancedConfig["source"],
    onLog: (log: string) => void,
    environment?: NodeJS.ProcessEnv,
  ): Promise<void> {
    const safeBranch = assertSafeGitRef(branch);
    const redactions = getUrlRedactions(cloneUrl);
    const timeoutMs = sourceConfig.timeoutSeconds * 1_000;
    const depthArgs =
      sourceConfig.fetchDepth > 0
        ? ["--depth", String(sourceConfig.fetchDepth)]
        : [];
    const gitDirectory = path.join(clonePath, ".git");
    const reusable = sourceConfig.reuseWorkspace && fs.existsSync(gitDirectory);

    fs.mkdirSync(path.dirname(clonePath), { recursive: true });
    if (reusable) {
      onLog(`Refreshing existing repository workspace at ${clonePath}...\n`);
      await this.runCommandAsync(
        "git",
        ["-C", clonePath, "remote", "set-url", "origin", cloneUrl],
        onLog,
        environment,
        { redactions, timeoutMs },
      );
      await this.runCommandAsync(
        "git",
        [
          "-C",
          clonePath,
          "fetch",
          "--prune",
          "--no-tags",
          ...depthArgs,
          "origin",
          safeBranch,
        ],
        onLog,
        environment,
        { redactions, timeoutMs },
      );
      await this.runCommandAsync(
        "git",
        ["-C", clonePath, "reset", "--hard"],
        onLog,
        environment,
        { timeoutMs },
      );
      await this.runCommandAsync(
        "git",
        ["-C", clonePath, "clean", "-fdx"],
        onLog,
        environment,
        { timeoutMs },
      );
      await this.runCommandAsync(
        "git",
        ["-C", clonePath, "checkout", "--detach", "FETCH_HEAD"],
        onLog,
        environment,
        { redactions, timeoutMs },
      );
    } else {
      if (fs.existsSync(clonePath)) {
        onLog("Cleaning up old build directory...\n");
        fs.rmSync(clonePath, { recursive: true, force: true });
      }
      onLog(`Cloning branch ${safeBranch} into ${clonePath}...\n`);
      const cloneArgs = [
        "clone",
        "--no-tags",
        "--filter=blob:none",
        ...depthArgs,
        "--branch",
        safeBranch,
        "--single-branch",
        "--",
        cloneUrl,
        clonePath,
      ];
      try {
        await this.runCommandAsync("git", cloneArgs, onLog, environment, {
          redactions,
          timeoutMs,
        });
      } catch (error: unknown) {
        // Some self-hosted Git servers do not advertise partial-clone support.
        // Retry once without the optimization while preserving all validation.
        onLog(
          `Partial clone was not supported; retrying a standard ${sourceConfig.fetchDepth > 0 ? "shallow " : ""}clone...\n`,
        );
        fs.rmSync(clonePath, { recursive: true, force: true });
        await this.runCommandAsync(
          "git",
          [
            "clone",
            "--no-tags",
            ...depthArgs,
            "--branch",
            safeBranch,
            "--single-branch",
            "--",
            cloneUrl,
            clonePath,
          ],
          onLog,
          environment,
          { redactions, timeoutMs },
        ).catch(() => {
          throw error;
        });
      }
    }

    if (sourceRevision) {
      await this.checkoutSourceRevision(
        clonePath,
        sourceRevision,
        onLog,
        environment,
        timeoutMs,
      );
    }

    if (sourceConfig.gitLfs) {
      onLog("Fetching Git LFS objects...\n");
      await this.runCommandAsync(
        "git",
        ["lfs", "version"],
        onLog,
        environment,
        { redactions, timeoutMs },
      );
      await this.runCommandAsync(
        "git",
        ["-C", clonePath, "lfs", "install", "--local"],
        onLog,
        environment,
        { redactions, timeoutMs },
      );
      await this.runCommandAsync(
        "git",
        ["-C", clonePath, "lfs", "pull", "origin", safeBranch],
        onLog,
        environment,
        { redactions, timeoutMs },
      );
    }
  }

  private async buildApplicationImage(
    resourceId: string,
    clonePath: string,
    imageName: string,
    config: ApplicationBuildConfig,
    envVars: Record<string, string>,
    onLog: (log: string) => void,
    buildSecrets: Record<string, string>,
    preserveForRollback: boolean,
  ): Promise<void> {
    switch (config.type) {
      case "dockerfile":
        await this.buildDockerfileImage(
          resourceId,
          clonePath,
          imageName,
          config,
          envVars,
          onLog,
          buildSecrets,
          preserveForRollback,
        );
        return;
      case "railpack":
        await this.buildRailpackImage(
          resourceId,
          clonePath,
          imageName,
          config.railpackVersion,
          envVars,
          onLog,
          buildSecrets,
          preserveForRollback,
        );
        return;
      case "nixpacks":
        await this.buildNixpacksImage(
          resourceId,
          clonePath,
          imageName,
          config.publishDirectory,
          envVars,
          onLog,
          preserveForRollback,
        );
        return;
      case "heroku-buildpacks":
        await this.buildPackImage(
          resourceId,
          clonePath,
          imageName,
          `heroku/builder:${config.herokuVersion}`,
          envVars,
          "Heroku Buildpacks",
          onLog,
          preserveForRollback,
        );
        return;
      case "paketo-buildpacks":
        await this.buildPackImage(
          resourceId,
          clonePath,
          imageName,
          "paketobuildpacks/builder-jammy-full",
          envVars,
          "Paketo Buildpacks",
          onLog,
          preserveForRollback,
        );
        return;
      case "static":
        await this.buildStaticImage(
          resourceId,
          clonePath,
          imageName,
          config.publishDirectory,
          config.spa,
          onLog,
          preserveForRollback,
        );
        return;
    }
  }

  private getRuntimeCommand(clonePath: string): string[] | undefined {
    try {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(clonePath, "package.json"), "utf8"),
      ) as { scripts?: { start?: string } };
      // Docusaurus binds its development server to localhost by default. A
      // Swarm service must listen on the task interface for Caddy to reach it.
      if (packageJson.scripts?.start?.includes("docusaurus start")) {
        return ["/bin/bash", "-lc", "npm run start -- --host 0.0.0.0"];
      }
    } catch {
      // A repository without package metadata keeps the image's native CMD.
    }
    return undefined;
  }

  private async buildDockerfileImage(
    resourceId: string,
    clonePath: string,
    imageName: string,
    config: Extract<ApplicationBuildConfig, { type: "dockerfile" }>,
    buildEnvVars: Record<string, string>,
    onLog: (log: string) => void,
    buildSecrets: Record<string, string> = {},
    preserveForRollback = false,
  ): Promise<void> {
    const dockerfilePath = this.resolveBuildPath(
      clonePath,
      config.dockerfilePath,
      "Dockerfile path",
    );
    const contextPath = this.resolveBuildPath(
      clonePath,
      config.dockerContextPath,
      "Docker context path",
    );

    if (!fs.statSync(dockerfilePath).isFile()) {
      throw new Error("Dockerfile path must point to a file");
    }
    if (!fs.statSync(contextPath).isDirectory()) {
      throw new Error("Docker context path must point to a directory");
    }

    const buildResourceDockerfile =
      this.resourceCommandBroker?.buildResourceDockerfile;
    const typedBuild =
      Object.keys(this.commandEnvironment).length === 0 &&
      Object.keys(buildSecrets).length === 0 &&
      buildResourceDockerfile;

    if (typedBuild) {
      onLog(
        `Building Dockerfile image ${imageName} through the typed Docker broker...\n`,
      );
      try {
        await buildResourceDockerfile(
          { kind: "local", name: "local" },
          resourceId,
          imageName,
          contextPath,
          dockerfilePath,
          {
            noCache: config.dockerNoCache,
            target: config.dockerBuildStage,
            buildArgs: {
              ...buildEnvVars,
              ...(config.dockerBuildArgs ?? {}),
            },
            preserveForRollback,
            onLog,
          },
        );
        return;
      } finally {
        if (config.dockerCleanupCache) {
          onLog("Cleaning unused Docker builder cache...\n");
          await this.runCommandAsync(
            "docker",
            ["builder", "prune", "--force"],
            onLog,
          ).catch((error) => {
            onLog(
              `Warning: Docker builder cache cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`,
            );
          });
        }
      }
    }

    const args = [
      "build",
      "--file",
      dockerfilePath,
      "--tag",
      imageName,
      "--label",
      `com.upstand.resource-id=${resourceId}`,
    ];
    if (preserveForRollback) {
      args.push("--label", "com.upstand.rollback.keep=true");
    }
    if (config.dockerNoCache) args.push("--no-cache");
    if (config.dockerBuildStage) {
      args.push("--target", config.dockerBuildStage);
    }
    const buildArgs = { ...buildEnvVars, ...config.dockerBuildArgs };
    for (const [key, value] of Object.entries(buildArgs)) {
      args.push("--build-arg", `${key}=${value}`);
    }
    for (const key of Object.keys(buildSecrets)) {
      args.push("--secret", `id=${key},env=${key}`);
    }
    args.push(contextPath);

    onLog(`Building Dockerfile image ${imageName}...\n`);
    try {
      await this.runCommandAsync(
        "docker",
        args,
        onLog,
        Object.keys(buildSecrets).length
          ? { ...getInheritedEnv(buildSecrets), DOCKER_BUILDKIT: "1" }
          : undefined,
        { redactions: Object.values(buildSecrets), resourceId },
      );
    } finally {
      if (config.dockerCleanupCache) {
        onLog("Cleaning unused Docker builder cache...\n");
        await this.runCommandAsync(
          "docker",
          ["builder", "prune", "--force"],
          onLog,
        ).catch((error) => {
          onLog(
            `Warning: Docker builder cache cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        });
      }
    }
  }

  private async buildRailpackImage(
    resourceId: string,
    clonePath: string,
    imageName: string,
    version: string,
    envVars: Record<string, string>,
    onLog: (log: string) => void,
    buildSecrets: Record<string, string> = {},
    preserveForRollback = false,
  ): Promise<void> {
    const railpack = await this.ensureRailpack(version, onLog);
    const planPath = path.join(clonePath, "railpack-plan.json");
    const infoPath = path.join(clonePath, "railpack-info.json");
    const buildEnvironment = this.getBuildEnvironment(
      {
        ...envVars,
        ...buildSecrets,
      },
      resourceId,
    );
    const environmentKeys = Object.keys({
      ...envVars,
      ...buildSecrets,
    }).sort();

    onLog(`Preparing Railpack v${version} build plan...\n`);
    await this.runCommandAsync(
      railpack,
      [
        "prepare",
        clonePath,
        "--plan-out",
        planPath,
        "--info-out",
        infoPath,
        ...environmentKeys.flatMap((key) => ["--env", key]),
      ],
      onLog,
      buildEnvironment,
      {
        redactions: [...Object.values(envVars), ...Object.values(buildSecrets)],
      },
    );

    const builderName = `upstand-railpack-${createHash("sha256")
      .update(`${imageName}:${Date.now()}`)
      .digest("hex")
      .slice(0, 12)}`;
    const secretHash = createHash("sha256")
      .update(
        Object.entries(envVars)
          .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
          .map(([key, value]) => `${key}=${value}`)
          .concat(
            Object.entries(buildSecrets)
              .sort(([firstKey], [secondKey]) =>
                firstKey.localeCompare(secondKey),
              )
              .map(([key, value]) => `${key}=${value}`),
          )
          .join("\n"),
      )
      .digest("hex");

    try {
      onLog("Validating Docker Buildx availability...\n");
      await this.runCommandAsync(
        "docker",
        ["buildx", "version"],
        onLog,
        undefined,
        { resourceId },
      );
      onLog("Starting an isolated BuildKit builder for Railpack...\n");
      await this.runCommandAsync(
        "docker",
        [
          "buildx",
          "create",
          "--name",
          builderName,
          "--driver",
          "docker-container",
        ],
        onLog,
        undefined,
        { resourceId },
      );
      await this.runCommandAsync(
        "docker",
        ["buildx", "inspect", "--builder", builderName, "--bootstrap"],
        onLog,
        undefined,
        { resourceId },
      );

      const buildArgs = [
        "buildx",
        "build",
        "--builder",
        builderName,
        "--build-arg",
        `BUILDKIT_SYNTAX=ghcr.io/railwayapp/railpack-frontend:v${version}`,
        "--build-arg",
        `secrets-hash=${secretHash}`,
        "--file",
        planPath,
        "--output",
        `type=docker,name=${imageName}`,
        "--label",
        `com.upstand.resource-id=${resourceId}`,
      ];
      if (preserveForRollback) {
        buildArgs.push("--label", "com.upstand.rollback.keep=true");
      }
      for (const key of environmentKeys) {
        buildArgs.push("--secret", `type=env,id=${key}`);
      }
      buildArgs.push(clonePath);

      onLog(`Building Railpack v${version} image ${imageName}...\n`);
      await this.runCommandAsync("docker", buildArgs, onLog, buildEnvironment, {
        redactions: [...Object.values(envVars), ...Object.values(buildSecrets)],
        resourceId,
      });
    } finally {
      await this.runCommandAsync(
        "docker",
        ["buildx", "rm", "--force", builderName],
        () => {},
        undefined,
        { resourceId },
      ).catch(() => undefined);
    }
  }

  private async buildNixpacksImage(
    resourceId: string,
    clonePath: string,
    imageName: string,
    publishDirectory: string | undefined,
    envVars: Record<string, string>,
    onLog: (log: string) => void,
    preserveForRollback = false,
  ): Promise<void> {
    const environmentKeys = Object.keys(envVars).sort();
    const buildArgs = ["build", clonePath, "--name", imageName];
    for (const key of environmentKeys) {
      buildArgs.push("--env", key);
    }
    if (publishDirectory) {
      buildArgs.push("--no-error-without-start");
    }

    onLog(`Building Nixpacks image ${imageName}...\n`);
    await this.runCommandAsync(
      "nixpacks",
      buildArgs,
      onLog,
      this.getBuildEnvironment(envVars, resourceId),
      { redactions: Object.values(envVars) },
    );

    if (!publishDirectory) {
      if (preserveForRollback) {
        await this.markImageForRollback(imageName, onLog, resourceId);
      }
      return;
    }

    const exportDirectory = this.resolveBuildPath(
      clonePath,
      publishDirectory,
      "Nixpacks publish directory",
      false,
    );
    const containerName = `upstand-export-${createHash("sha256")
      .update(`${imageName}:${Date.now()}`)
      .digest("hex")
      .slice(0, 12)}`;
    fs.mkdirSync(exportDirectory, { recursive: true });
    try {
      await this.runCommandAsync(
        "docker",
        ["create", "--name", containerName, imageName],
        onLog,
        undefined,
        { resourceId },
      );
      await this.runCommandAsync(
        "docker",
        ["cp", `${containerName}:/app/${publishDirectory}/.`, exportDirectory],
        onLog,
        undefined,
        { resourceId },
      );
      await this.buildStaticImage(
        resourceId,
        clonePath,
        imageName,
        publishDirectory,
        false,
        onLog,
        preserveForRollback,
      );
    } finally {
      await this.runCommandAsync(
        "docker",
        ["rm", "--force", containerName],
        () => {},
        undefined,
        { resourceId },
      ).catch(() => undefined);
    }
  }

  private async buildPackImage(
    resourceId: string,
    clonePath: string,
    imageName: string,
    builder: string,
    envVars: Record<string, string>,
    label: string,
    onLog: (log: string) => void,
    preserveForRollback = false,
  ): Promise<void> {
    const args = [
      "build",
      imageName,
      "--path",
      clonePath,
      "--builder",
      builder,
    ];
    for (const key of Object.keys(envVars).sort()) {
      // Pack resolves a value-less key from its process environment. This keeps
      // build secrets out of the process argument list and deployment logs.
      args.push("--env", key);
    }
    onLog(`Building ${label} image ${imageName}...\n`);
    await this.runCommandAsync(
      "pack",
      args,
      onLog,
      this.getBuildEnvironment(envVars, resourceId),
    );
    if (preserveForRollback) {
      await this.markImageForRollback(imageName, onLog, resourceId);
    }
  }

  /**
   * Nixpacks and pack do not expose a portable image-label flag. Re-commit a
   * stopped, freshly-created container with the rollback label so cleanup can
   * preserve the image without changing its filesystem or runtime config.
   */
  private async markImageForRollback(
    imageName: string,
    onLog: (log: string) => void,
    resourceId?: string,
  ): Promise<void> {
    const markResourceImageForRollback =
      this.resourceCommandBroker?.markResourceImageForRollback;
    if (
      resourceId &&
      Object.keys(this.commandEnvironment).length === 0 &&
      markResourceImageForRollback
    ) {
      onLog(
        `Marking image ${imageName} through the typed Docker broker for rollback protection...\n`,
      );
      await markResourceImageForRollback(
        { kind: "local", name: "local" },
        resourceId,
        imageName,
      );
      return;
    }
    const suffix = createHash("sha256")
      .update(`${imageName}:${Date.now()}`)
      .digest("hex")
      .slice(0, 12);
    const containerName = `upstand-rollback-marker-${suffix}`;
    const imageTagSeparator = imageName.lastIndexOf(":");
    const markerImage =
      imageTagSeparator > 0
        ? `${imageName.slice(0, imageTagSeparator)}:${imageName.slice(
            imageTagSeparator + 1,
          )}-rollback-marker-${suffix}`
        : `${imageName}-rollback-marker-${suffix}`;
    try {
      onLog(`Marking image ${imageName} as rollback-protected...\n`);
      await this.runCommandAsync(
        "docker",
        [
          "create",
          "--name",
          containerName,
          ...(resourceId
            ? ["--label", `com.upstand.resource-id=${resourceId}`]
            : []),
          imageName,
        ],
        onLog,
        undefined,
        { resourceId },
      );
      await this.runCommandAsync(
        "docker",
        [
          "commit",
          "--change",
          "LABEL com.upstand.rollback.keep=true",
          containerName,
          markerImage,
        ],
        onLog,
        undefined,
        { resourceId },
      );
      await this.runCommandAsync(
        "docker",
        ["tag", markerImage, imageName],
        onLog,
        undefined,
        { resourceId },
      );
    } finally {
      await this.runCommandAsync(
        "docker",
        ["rm", "--force", containerName],
        () => {},
        undefined,
        { resourceId },
      ).catch(() => undefined);
      await this.runCommandAsync(
        "docker",
        ["image", "rm", markerImage],
        () => {},
        undefined,
        { resourceId },
      ).catch(() => undefined);
    }
  }

  private async buildStaticImage(
    resourceId: string,
    clonePath: string,
    imageName: string,
    publishDirectory: string,
    spa: boolean,
    onLog: (log: string) => void,
    preserveForRollback = false,
  ): Promise<void> {
    const resolvedPublishDirectory = this.resolveBuildPath(
      clonePath,
      publishDirectory,
      "Static publish directory",
    );
    if (!fs.statSync(resolvedPublishDirectory).isDirectory()) {
      throw new Error("Static publish directory must point to a directory");
    }

    const staticContext = path.join(
      path.dirname(clonePath),
      `.upstand-static-${createHash("sha256")
        .update(`${imageName}:${Date.now()}`)
        .digest("hex")
        .slice(0, 12)}`,
    );
    const assetsDirectory = path.join(staticContext, "site");
    const dockerfilePath = path.join(staticContext, "Dockerfile");
    const nginxConfigPath = path.join(staticContext, "nginx.conf");
    const dockerfile = [
      "FROM nginx:1.29-alpine",
      "RUN rm -rf /usr/share/nginx/html/*",
      "WORKDIR /usr/share/nginx/html",
      'COPY ["nginx.conf", "/etc/nginx/conf.d/default.conf"]',
      'COPY ["site/", "/usr/share/nginx/html/"]',
    ].join("\n");
    const nginxConfig = [
      "server {",
      "  listen 80;",
      "  server_name _;",
      "  root /usr/share/nginx/html;",
      "  index index.html index.htm;",
      spa
        ? "  location / { try_files $uri $uri/ /index.html; }"
        : "  location / { try_files $uri $uri/ =404; }",
      "}",
    ].join("\n");

    fs.mkdirSync(staticContext, { recursive: true });
    fs.cpSync(resolvedPublishDirectory, assetsDirectory, {
      recursive: true,
      filter: (source) => {
        const name = path.basename(source);
        return name !== ".git" && name !== ".env" && !name.startsWith(".env.");
      },
    });
    fs.writeFileSync(dockerfilePath, dockerfile, "utf8");
    fs.writeFileSync(nginxConfigPath, nginxConfig, "utf8");
    try {
      onLog(`Building ${spa ? "SPA" : "static"} image ${imageName}...\n`);
      await this.runCommandAsync(
        "docker",
        [
          "build",
          "--file",
          dockerfilePath,
          "--tag",
          imageName,
          "--label",
          `com.upstand.resource-id=${resourceId}`,
          ...(preserveForRollback
            ? ["--label", "com.upstand.rollback.keep=true"]
            : []),
          staticContext,
        ],
        onLog,
        undefined,
        { resourceId },
      );
    } finally {
      fs.rmSync(staticContext, { recursive: true, force: true });
    }
  }

  private resolveBuildPath(
    clonePath: string,
    requestedPath: string,
    label: string,
    mustExist = true,
  ): string {
    if (path.isAbsolute(requestedPath)) {
      throw new Error(`${label} must be relative to the repository root`);
    }

    const root = fs.realpathSync(clonePath);
    const candidate = path.resolve(root, requestedPath);
    const relative = path.relative(root, candidate);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`${label} must stay within the repository root`);
    }
    if (!mustExist) {
      return candidate;
    }
    if (!fs.existsSync(candidate)) {
      throw new Error(`${label} does not exist: ${requestedPath}`);
    }
    const realCandidate = fs.realpathSync(candidate);
    const realRelative = path.relative(root, realCandidate);
    if (
      realRelative === ".." ||
      realRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(realRelative)
    ) {
      throw new Error(`${label} resolves outside the repository root`);
    }
    return realCandidate;
  }

  private getBuildEnvironment(
    envVars: Record<string, string>,
    resourceId?: string,
  ): NodeJS.ProcessEnv {
    return {
      ...getInheritedEnv(envVars),
      ...(resourceId ? this.getDockerCommandEnvironment(resourceId) : {}),
    };
  }

  private getDockerCommandEnvironment(
    resourceId: string,
  ): Record<string, string | undefined> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(resourceId)) {
      throw new Error("Docker resource scope is invalid");
    }
    const inheritedHeaders = (
      this.commandEnvironment.DOCKER_CUSTOM_HEADERS ??
      process.env.DOCKER_CUSTOM_HEADERS ??
      ""
    )
      .split(",")
      .map((header) => header.trim())
      .filter(
        (header) =>
          header.length > 0 &&
          !header.toLowerCase().startsWith("x-upstand-resource-id="),
      );
    return {
      DOCKER_CUSTOM_HEADERS: [
        ...inheritedHeaders,
        `X-Upstand-Resource-ID=${resourceId}`,
      ].join(","),
    };
  }

  private async ensureRailpack(
    version: string,
    onLog: (log: string) => void,
  ): Promise<string> {
    const platform = process.arch === "arm64" ? "arm64" : "x86_64";
    const target = `${platform}-unknown-linux-musl`;
    const toolsDirectory = path.join(
      process.cwd(),
      ".tools",
      `railpack-${version}`,
    );
    const binaryPath = path.join(toolsDirectory, "railpack");
    if (fs.existsSync(binaryPath)) {
      return binaryPath;
    }

    fs.mkdirSync(toolsDirectory, { recursive: true });
    const archivePath = path.join(toolsDirectory, "railpack.tar.gz");
    const releaseUrl = `https://github.com/railwayapp/railpack/releases/download/v${version}/railpack-v${version}-${target}.tar.gz`;
    onLog(`Downloading pinned Railpack v${version} binary...\n`);
    try {
      await this.runCommandAsync(
        "curl",
        [
          "--fail",
          "--location",
          "--retry",
          "3",
          "--retry-all-errors",
          "--output",
          archivePath,
          releaseUrl,
        ],
        onLog,
      );
      await this.runCommandAsync(
        "tar",
        ["-xzf", archivePath, "-C", toolsDirectory],
        onLog,
      );
      fs.chmodSync(binaryPath, 0o755);
      return binaryPath;
    } catch (error) {
      fs.rmSync(toolsDirectory, { recursive: true, force: true });
      throw error;
    } finally {
      fs.rmSync(archivePath, { force: true });
    }
  }

  async deployComposeStack(
    resource: Resource,
    rawCompose: string,
    onLog: (log: string) => void,
    constraints?: string[],
    envVars?: Record<string, string>,
  ): Promise<void> {
    const stackName = this.sanitizeName(resource.appName || resource.name);
    const deploymentNetwork = await this.ensureDeploymentNetwork(resource);

    const buildDir = path.join(process.cwd(), ".builds");
    const composeDir = path.join(buildDir, resource.id);
    fs.mkdirSync(composeDir, { recursive: true });
    const composePath = path.join(composeDir, "docker-compose.yml");
    let composeContent = "";

    try {
      const advancedConfig = parseResourceAdvancedConfig(
        resource.advancedConfig,
      );
      const composeSource = advancedConfig.randomize
        ? randomizeComposeFile(rawCompose, advancedConfig.randomSuffix)
        : rawCompose;
      composeContent = applyComposeResourceConfig(
        composeSource,
        resource,
        advancedConfig,
      );
      try {
        composeContent = applyComposeIngressNetwork(
          composeContent,
          deploymentNetwork.name,
          advancedConfig.isolatedDeployment &&
            advancedConfig.isolatedDeploymentsVolume,
          stackName,
        );
      } catch (error) {
        throw new Error(
          `Unable to prepare Compose networking: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // Inject placement constraints if provided
      if (constraints && constraints.length > 0) {
        composeContent = applyComposePlacementConstraints(
          composeContent,
          constraints,
        );
      }

      composeContent = await this.ensureTypedComposeResources(
        composeContent,
        resource,
        stackName,
      );

      writePrivateDeploymentFile(composePath, composeContent);

      const composeCommand =
        resource.composeType === "compose"
          ? [
              "compose",
              "--project-name",
              stackName,
              "--file",
              composePath,
              "up",
              "--detach",
              "--remove-orphans",
            ]
          : ["stack", "deploy", "--compose-file", composePath, stackName];
      onLog(
        resource.composeType === "compose"
          ? `Deploying Docker Compose project '${stackName}'...\n`
          : `Deploying Docker Swarm stack '${stackName}'...\n`,
      );
      const composeEnv =
        envVars ?? parseResourceEnvironmentVariables(resource.envVars);
      await this.runCommandAsync(
        "docker",
        composeCommand,
        onLog,
        composeEnv as NodeJS.ProcessEnv,
        {
          redactions: Object.values(composeEnv),
          resourceId: resource.id,
        },
      );

      // `docker compose up --detach` can return successfully before an image
      // finishes its startup sequence. Verify the resulting containers so a
      // crash loop or an unhealthy service cannot be reported as a successful
      // deployment. Swarm stacks use the separate convergence path.
      if (resource.composeType === "compose") {
        await this.waitForComposeConvergence(stackName, resource.id, onLog);
      }
    } finally {
      fs.rmSync(composeDir, { recursive: true, force: true });
    }
  }

  private async ensureTypedComposeResources(
    rawCompose: string,
    resource: Resource,
    projectName: string,
  ): Promise<string> {
    const ensureNetwork = this.resourceCommandBroker?.ensureResourceNetwork;
    const ensureVolume = this.resourceCommandBroker?.ensureResourceVolume;
    if (!this.resourceCommandBroker) return rawCompose;
    if (!ensureNetwork || !ensureVolume) {
      throw new Error(
        "Typed Compose resource provisioning is unavailable for the configured Docker broker",
      );
    }

    const parsed = yaml.parse(rawCompose) as {
      services?: Record<string, Record<string, unknown>>;
      networks?: Record<string, unknown>;
      volumes?: Record<string, unknown>;
    };
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Compose file must contain an object document");
    }

    const composeType =
      resource.composeType === "compose"
        ? ("compose" as const)
        : ("stack" as const);
    const networks = parsed.networks ?? {};
    for (const [networkKey, definition] of Object.entries(networks)) {
      if (networkKey === "upstand_ingress") continue;
      const internal =
        isUnknownRecord(definition) && definition.internal === true;
      const ensured = await ensureNetwork(
        { kind: "local", name: "local" },
        resource.id,
        {
          networkKey,
          projectName,
          composeType,
          internal,
        },
      );
      parsed.networks ??= {};
      parsed.networks[networkKey] = {
        name: ensured.name,
        external: true,
      };
    }

    parsed.volumes ??= {};
    if (parsed.services) {
      for (const service of Object.values(parsed.services)) {
        const volumes = service.volumes;
        if (!Array.isArray(volumes)) continue;
        for (const volume of volumes) {
          let source: string | undefined;
          if (typeof volume === "string") {
            source = volume.split(":", 1)[0];
          } else if (
            isUnknownRecord(volume) &&
            typeof volume.source === "string"
          ) {
            source = volume.source;
          }
          if (
            source &&
            !source.startsWith(".") &&
            !source.startsWith("/") &&
            !source.startsWith("~") &&
            !/^[A-Za-z]:[\\/]/.test(source)
          ) {
            parsed.volumes[source] ??= {};
          }
        }
      }
    }
    for (const volumeKey of Object.keys(parsed.volumes)) {
      await ensureVolume(
        { kind: "local", name: "local" },
        resource.id,
        volumeKey,
        projectName,
        composeType,
      );
      parsed.volumes[volumeKey] = {
        name: `upstand-resource-${resource.id.toLowerCase()}-volume-${volumeKey}`,
        external: true,
      };
    }

    return yaml.stringify(parsed);
  }

  private async waitForComposeConvergence(
    projectName: string,
    resourceId: string,
    onLog: (log: string) => void,
  ): Promise<void> {
    const scopedDocker =
      this.resourceScopedDockerFactory?.(resourceId) ?? this.docker;
    const timeoutMs = 60_000;
    const stabilityMs = 5_000;
    const startedAt = Date.now();
    let stableSince: number | null = null;
    let lastObservedState = "No Compose containers found yet";

    onLog(
      `Verifying Docker Compose project '${projectName}' startup and health...\n`,
    );

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const containers = await scopedDocker.listContainers({
          all: true,
          filters: JSON.stringify({
            label: [
              `com.docker.compose.project=${projectName}`,
              `com.upstand.resource-id=${resourceId}`,
            ],
          }),
        });

        if (containers.length > 0) {
          const states = await mapWithConcurrency(
            containers,
            async (container) => {
              const inspected = await scopedDocker
                .getContainer(container.Id)
                .inspect();
              return {
                name: container.Names?.[0]?.replace(/^\//, "") || container.Id,
                status: inspected.State?.Status ?? container.State,
                exitCode: inspected.State?.ExitCode ?? 0,
                health: inspected.State?.Health?.Status,
              };
            },
          );

          const failed = states.find(
            (state) =>
              (state.status === "exited" || state.status === "dead") &&
              state.exitCode !== 0,
          );
          if (failed) {
            throw new Error(
              `Compose container '${failed.name}' exited with code ${failed.exitCode}`,
            );
          }

          const unhealthy = states.find(
            (state) => state.health === "unhealthy",
          );
          if (unhealthy) {
            throw new Error(
              `Compose container '${unhealthy.name}' reported an unhealthy status`,
            );
          }

          const pending = states.filter(
            (state) =>
              !["running", "exited"].includes(state.status) ||
              state.health === "starting",
          );
          const successful = states.filter(
            (state) => state.status === "running" || state.exitCode === 0,
          );
          lastObservedState = states
            .map(
              (state) =>
                `${state.name}:${state.status}${state.health ? `/${state.health}` : ""}`,
            )
            .join(", ");

          if (pending.length === 0 && successful.length === states.length) {
            if (stableSince === null) stableSince = Date.now();
            if (Date.now() - stableSince >= stabilityMs) {
              onLog(
                `Docker Compose project '${projectName}' is running stably. ✅\n`,
              );
              return;
            }
          } else {
            stableSince = null;
          }
        }
      } catch (error) {
        if (
          error instanceof Error &&
          /Compose container .* (?:exited|reported an unhealthy)/.test(
            error.message,
          )
        ) {
          onLog(`Docker Compose convergence failed: ${error.message}. ❌\n`);
          throw error;
        }
        // Docker may briefly reject an inspect while Compose is replacing a
        // container. Keep polling until the bounded convergence timeout.
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error(
      `Docker Compose project '${projectName}' did not converge within ${timeoutMs / 1000} seconds (last state: ${lastObservedState})`,
    );
  }

  async controlService(
    resource: Resource,
    cmd: "start" | "stop" | "restart",
  ): Promise<void> {
    const serviceName = this.sanitizeName(resource.appName || resource.name);

    if (resource.type === "compose") {
      const scopedDocker =
        this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;
      // Compose resources are either Docker Compose projects or Swarm stacks.
      if (cmd === "stop") {
        if (resource.composeType === "compose") {
          const containers = await scopedDocker.listContainers({
            all: true,
            filters: JSON.stringify({
              label: [
                `com.docker.compose.project=${serviceName}`,
                `com.upstand.resource-id=${resource.id}`,
              ],
            }),
          });
          await mapWithConcurrency(containers, (container) =>
            scopedDocker.getContainer(container.Id).remove({ force: true }),
          );
        } else {
          await this.runCommandAsync(
            "docker",
            ["stack", "rm", serviceName],
            () => {},
          );
        }
      } else if (cmd === "start" || cmd === "restart") {
        let composeFile = "";
        try {
          if (resource.credentials) {
            const config = parseResourceCredentials(resource.credentials);
            const configuredComposeFile = config.composeFile;
            composeFile =
              typeof configuredComposeFile === "string"
                ? configuredComposeFile
                : "";
          }
        } catch {}
        if (!composeFile) {
          throw new Error("No compose file configuration found to start stack");
        }
        await this.deployComposeStack(resource, composeFile, () => {});
      }
      return;
    }

    // Single Swarm Service control
    const serviceDocker =
      this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;
    const service = serviceDocker.getService(serviceName);
    let inspect: Awaited<ReturnType<typeof service.inspect>>;
    try {
      inspect = await service.inspect();
    } catch (err: unknown) {
      if (errorStatusCode(err) === 404 && cmd === "start") {
        const envVars = parseResourceEnvironmentVariables(resource.envVars);
        if (resource.type === "database") {
          log.info({
            message: `Swarm service '${serviceName}' not found. Deploying database service...`,
          });
          await this.deployDatabase(resource, envVars);
          return;
        }
        if (
          resource.type === "application" &&
          resource.provider === "docker-registry"
        ) {
          log.info({
            message: `Swarm service '${serviceName}' not found. Deploying application image...`,
          });
          await this.deployAppImage(resource, envVars);
          return;
        }
        throw new Error(
          `Service '${serviceName}' not found. Please deploy the resource first.`,
        );
      }
      throw err;
    }

    if (cmd === "stop") {
      log.info({ message: `Stopping Swarm service '${serviceName}'...` });
      await service.update({
        version: inspect.Version.Index,
        Name: serviceName,
        Mode: { Replicated: { Replicas: 0 } },
        TaskTemplate: inspect.Spec.TaskTemplate,
      });
    } else if (cmd === "start") {
      log.info({ message: `Starting Swarm service '${serviceName}'...` });
      await service.update({
        version: inspect.Version.Index,
        Name: serviceName,
        Mode: { Replicated: { Replicas: 1 } },
        TaskTemplate: inspect.Spec.TaskTemplate,
        EndpointSpec: inspect.Spec.EndpointSpec,
      });
    } else if (cmd === "restart") {
      log.info({ message: `Restarting Swarm service '${serviceName}'...` });
      // Update task template with a restart timestamp env var to force update
      const taskTemplate = inspect.Spec.TaskTemplate || {};
      const containerSpec = taskTemplate.ContainerSpec || {};
      const env = containerSpec.Env || [];
      const filteredEnv = env.filter(
        (e: string) => !e.startsWith("UPSTAND_RESTART="),
      );
      filteredEnv.push(`UPSTAND_RESTART=${Date.now()}`);
      containerSpec.Env = filteredEnv;

      await service.update({
        version: inspect.Version.Index,
        Name: serviceName,
        Mode: inspect.Spec.Mode,
        TaskTemplate: taskTemplate,
        EndpointSpec: inspect.Spec.EndpointSpec,
      });
    }
  }

  /**
   * Ask Swarm to apply the service's configured rollback specification. This
   * is deliberately a separate operation from restart: restart recreates
   * tasks from the current spec, while rollback restores the previous
   * service spec tracked by Swarm.
   */
  async rollbackService(
    resource: Resource,
    registryAuth?: DockerRegistryAuth,
    serviceNameOverride?: string,
  ): Promise<void> {
    if (resource.type === "compose") {
      throw new ConflictError(
        "Compose resources do not have a Swarm service rollback. Redeploy the desired Compose revision instead.",
      );
    }

    const serviceName = this.sanitizeName(
      serviceNameOverride || resource.appName || resource.name,
    );
    const serviceDocker =
      this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;
    const service = serviceDocker.getService(serviceName);
    const inspect = await service.inspect();

    const update = (
      service as unknown as {
        update: (
          auth: DockerRegistryAuth | undefined,
          options: Record<string, unknown>,
        ) => Promise<unknown>;
      }
    ).update;
    if (typeof update !== "function") {
      throw new ConflictError(
        "The connected Docker client does not support Swarm service updates.",
      );
    }

    // Dockerode does not expose `docker service rollback`, but the Engine API
    // implements it as a service update with rollback=previous. Supplying the
    // registry auth header is important when the previous image is private.
    await update.call(service, registryAuth, {
      ...inspect.Spec,
      Name: serviceName,
      version: inspect.Version.Index,
      rollback: "previous",
    });
  }

  async promoteServiceRevision(
    resource: Resource,
    revisionServiceName: string,
  ): Promise<void> {
    if (resource.type !== "application") {
      throw new ConflictError("Only application revisions can be promoted");
    }
    const baseServiceName = this.sanitizeName(
      resource.appName || resource.name,
    );
    const revisionName = this.sanitizeName(revisionServiceName);
    if (
      !revisionName ||
      revisionName === baseServiceName ||
      !revisionName.startsWith(`${baseServiceName}-`)
    ) {
      throw new ConflictError("Invalid deployment revision service name");
    }
    const promoteResourceServiceRevision =
      this.resourceCommandBroker?.promoteResourceServiceRevision;
    if (promoteResourceServiceRevision && this.cacheDockerDiskUsage) {
      await promoteResourceServiceRevision(
        { kind: "local", name: "local" },
        resource.id,
        baseServiceName,
        revisionName,
      );
      return;
    }
    const serviceDocker =
      this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;
    const baseService = serviceDocker.getService(baseServiceName);
    const revisionService = serviceDocker.getService(revisionName);
    const [base, revision] = await Promise.all([
      baseService.inspect(),
      revisionService.inspect(),
    ]);
    const revisionLabels = revision.Spec?.Labels ?? {};
    if (
      revisionLabels["com.upstand.resource-id"] !== resource.id ||
      revisionLabels["com.upstand.deployment-revision"] !== "true"
    ) {
      throw new ConflictError(
        "Deployment revision does not belong to this resource",
      );
    }
    await baseService.update({
      version: base.Version.Index,
      Name: baseServiceName,
      Mode: base.Spec.Mode,
      TaskTemplate: revision.Spec.TaskTemplate,
      EndpointSpec: base.Spec.EndpointSpec,
      UpdateConfig: base.Spec.UpdateConfig,
      RollbackConfig: base.Spec.RollbackConfig,
    });
  }

  async removeServiceRevision(
    resource: Resource,
    revisionServiceName: string,
  ): Promise<void> {
    const baseServiceName = this.sanitizeName(
      resource.appName || resource.name,
    );
    const revisionName = this.sanitizeName(revisionServiceName);
    if (
      !revisionName ||
      revisionName === baseServiceName ||
      !revisionName.startsWith(`${baseServiceName}-`)
    ) {
      throw new ConflictError("Invalid deployment revision service name");
    }
    const serviceDocker =
      this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;
    const service = serviceDocker.getService(revisionName);
    try {
      const inspect = await service.inspect();
      const labels = inspect.Spec?.Labels ?? {};
      if (
        labels["com.upstand.resource-id"] !== resource.id ||
        labels["com.upstand.deployment-revision"] !== "true"
      ) {
        throw new ConflictError(
          "Deployment revision does not belong to this resource",
        );
      }
      const removeResourceService =
        this.resourceCommandBroker?.removeResourceService;
      if (removeResourceService) {
        await removeResourceService(
          { kind: "local", name: "local" },
          resource.id,
          revisionName,
        );
      } else {
        await service.remove();
      }
    } catch (error: unknown) {
      if (errorStatusCode(error) === 404) return;
      throw error;
    }
  }

  async scaleService(resource: Resource, replicas: number): Promise<void> {
    if (!Number.isInteger(replicas) || replicas < 0 || replicas > 1000) {
      throw new ConflictError(
        "Replica count must be an integer between 0 and 1000",
      );
    }
    if (resource.type === "compose") {
      throw new ConflictError(
        "Autoscaling Compose resources is not supported; configure replicas in the Compose file",
      );
    }
    const serviceName = this.sanitizeName(resource.appName || resource.name);
    const scaleResourceService =
      this.resourceCommandBroker?.scaleResourceService;
    if (scaleResourceService && this.cacheDockerDiskUsage) {
      await scaleResourceService(
        { kind: "local", name: "local" },
        resource.id,
        serviceName,
        replicas,
      );
      return;
    }
    const serviceDocker =
      this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;
    const service = serviceDocker.getService(serviceName);
    const inspect = await service.inspect();
    await service.update({
      version: inspect.Version.Index,
      Name: serviceName,
      Mode: { Replicated: { Replicas: replicas } },
      TaskTemplate: inspect.Spec.TaskTemplate,
      EndpointSpec: inspect.Spec.EndpointSpec,
      UpdateConfig: inspect.Spec.UpdateConfig,
      RollbackConfig: inspect.Spec.RollbackConfig,
    });
  }

  async serviceExists(
    resource: Resource,
    serviceNameOverride?: string,
  ): Promise<boolean> {
    const serviceName = this.sanitizeName(
      serviceNameOverride || resource.appName || resource.name,
    );
    try {
      const serviceDocker =
        this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;
      await serviceDocker.getService(serviceName).inspect();
      return true;
    } catch (error: unknown) {
      if (errorStatusCode(error) === 404) return false;
      throw error;
    }
  }

  async configureDatabaseReplication(
    resource: Resource,
    envVars: Record<string, string>,
  ): Promise<void> {
    if (
      resource.type !== "database" ||
      resource.dbType?.toLowerCase() !== "postgres"
    ) {
      throw new ConflictError(
        "Managed replication currently supports PostgreSQL resources only",
      );
    }
    const config = parseResourceAdvancedConfig(
      resource.advancedConfig,
    ).databaseReplication;
    const primaryName = this.sanitizeName(resource.appName || resource.name);
    const replicaName = `${primaryName}-replica`;
    const scopedDocker =
      this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;
    if (!config.enabled) {
      try {
        const removeResourceService =
          this.resourceCommandBroker?.removeResourceService;
        if (removeResourceService) {
          await removeResourceService(
            { kind: "local", name: "local" },
            resource.id,
            replicaName,
          );
        } else {
          await scopedDocker.getService(replicaName).remove();
        }
      } catch (error: unknown) {
        if (errorStatusCode(error) !== 404) throw error;
      }
      return;
    }
    const image = (resource.dockerImage || "").toLowerCase();
    if (!image.includes("bitnami/postgresql-repmgr")) {
      throw new ConflictError(
        "PostgreSQL replication requires a bitnami/postgresql-repmgr primary image so replication is configured safely",
      );
    }
    const network = await this.ensureDeploymentNetwork(resource);
    const password =
      envVars.POSTGRES_PASSWORD || envVars.POSTGRESQL_PASSWORD || "";
    const repmgrPassword = envVars.REPMGR_PASSWORD || password;
    const serviceSpec: Docker.CreateServiceOptions = {
      Name: replicaName,
      Labels: {
        "com.upstand.resource-id": resource.id,
        "com.upstand.database-replica": "true",
      },
      TaskTemplate: {
        ContainerSpec: {
          Image: resource.dockerImage ?? "bitnami/postgresql-repmgr:16",
          Env: [
            `POSTGRESQL_POSTGRES_PASSWORD=${envVars.POSTGRES_POSTGRES_PASSWORD || password}`,
            `POSTGRESQL_USERNAME=${envVars.POSTGRES_USER || "upstand"}`,
            `POSTGRESQL_PASSWORD=${password}`,
            `POSTGRESQL_DATABASE=${envVars.POSTGRES_DB || "upstand"}`,
            "POSTGRESQL_REPLICATION_MODE=slave",
            `REPMGR_USERNAME=${config.replicationUser}`,
            `REPMGR_PASSWORD=${repmgrPassword}`,
            `REPMGR_PRIMARY_HOST=${primaryName}`,
            "REPMGR_PRIMARY_PORT=5432",
            `REPMGR_PARTNER_NODES=${primaryName}:5432,${replicaName}:5432`,
            `REPMGR_NODE_NAME=${replicaName}`,
            `REPMGR_NODE_NETWORK_NAME=${replicaName}`,
            `REPMGR_FAILOVER=${config.automaticFailover ? "automatic" : "manual"}`,
          ],
        },
        Networks: [{ Target: network.id }],
        RestartPolicy: { Condition: "on-failure" },
      },
      Mode: { Replicated: { Replicas: config.replicaCount } },
      UpdateConfig: {
        Parallelism: 1,
        FailureAction: "rollback",
        Order: "start-first",
      },
      RollbackConfig: {
        Parallelism: 1,
        FailureAction: "pause",
        Order: "stop-first",
      },
    };
    await this.upsertService(
      replicaName,
      serviceSpec,
      undefined,
      undefined,
      resource.id,
    );
  }

  async controlContainer(
    resource: Resource,
    containerId: string,
    cmd: "start" | "stop" | "restart" | "kill",
  ): Promise<void> {
    const containers = await this.getContainers(resource);
    const target = containers.find(
      (container) =>
        typeof container.id === "string" &&
        (container.id === containerId ||
          container.id.startsWith(containerId) ||
          containerId.startsWith(container.id)),
    );
    if (!target) {
      throw new ConflictError(
        "The selected container is no longer part of this resource. Refresh the container list and try again.",
      );
    }

    const scopedDocker =
      this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;
    const container = scopedDocker.getContainer(target.id);
    try {
      await container.inspect();
    } catch (error: unknown) {
      if (errorStatusCode(error) === 404) {
        throw new ConflictError(
          "This replica is running on another Swarm node. Manage it from the node that hosts the container or use the resource restart action.",
        );
      }
      throw error;
    }

    if (cmd === "start") await container.start();
    if (cmd === "stop") await container.stop();
    if (cmd === "restart") await container.restart();
    if (cmd === "kill") {
      // A standalone Compose service may have `restart: always` or
      // `restart: unless-stopped`. A raw kill then immediately creates a new
      // container, which makes the UI appear to undo the operator action.
      // Temporarily disable the policy for this explicit container action,
      // kill the current container, then restore the service's policy while
      // it remains stopped. Future deployments still apply the Compose file.
      if (shouldSuppressComposeRestart(resource, cmd)) {
        const inspection = await container.inspect();
        const restartPolicy = inspection.HostConfig?.RestartPolicy;
        await container.update({ RestartPolicy: { Name: "no" } });
        try {
          await container.kill({ signal: "SIGKILL" });
        } finally {
          await container.update({ RestartPolicy: restartPolicy });
        }
      } else {
        // Swarm and other orchestrators intentionally replace killed tasks.
        // That is the correct semantics for a task-level kill; use the
        // resource stop/scale action when the desired replica count must drop.
        await container.kill({ signal: "SIGKILL" });
      }
    }
  }

  async getContainers(resource: Resource): Promise<DockerResourceContainer[]> {
    const nameFilter = this.sanitizeName(resource.appName || resource.name);
    const scopedDocker =
      this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;

    if (resource.type === "compose") {
      if (resource.composeType === "compose") {
        try {
          const containers = await scopedDocker.listContainers({
            all: true,
            filters: JSON.stringify({
              label: [
                `com.docker.compose.project=${nameFilter}`,
                `com.upstand.resource-id=${resource.id}`,
              ],
            }),
          });
          return containers.map((container) => ({
            id: container.Id.substring(0, 12),
            name: (container.Names?.[0] || container.Id).replace(/^\//, ""),
            status: container.State || "unknown",
            ports:
              container.Ports?.map((port) =>
                port.PublicPort
                  ? `${port.PublicPort}:${port.PrivatePort}`
                  : `${port.PrivatePort}`,
              ).join(", ") || "N/A",
            node: "local",
          }));
        } catch (err: unknown) {
          log.error({
            message: "Error getting Docker Compose containers",
            err,
          });
          throw err;
        }
      }

      // Find all services in the stack
      try {
        const services = await scopedDocker.listServices({
          filters: JSON.stringify({
            label: [
              `com.docker.stack.namespace=${nameFilter}`,
              `com.upstand.resource-id=${resource.id}`,
            ],
          }),
        });

        const containersList: DockerResourceContainer[] = [];
        const nodes = await scopedDocker.listNodes().catch(() => []);
        const nodeMap = new Map(
          nodes.map((n) => [n.ID, n.Description?.Hostname || n.ID]),
        );

        for (const s of services) {
          const serviceName = s.Spec?.Name || "";
          const tasks = await scopedDocker.listTasks({
            filters: JSON.stringify({
              service: [serviceName],
              "desired-state": ["running"],
            }),
          });

          for (const task of tasks) {
            if (task.Status?.State || task.DesiredState) {
              const nodeName =
                nodeMap.get(task.NodeID) || task.NodeID || "local";
              const ports =
                s.Endpoint?.Ports?.map(
                  (p) => `${p.PublishedPort}:${p.TargetPort}`,
                ).join(", ") || "N/A";
              containersList.push({
                id: (
                  task.Status?.ContainerStatus?.ContainerID || task.ID
                ).substring(0, 64),
                name: `${serviceName}.${task.Slot || 1}`,
                status: task.Status?.State || "unknown",
                ports,
                node: nodeName,
              });
            }
          }
        }
        return containersList;
      } catch (err: unknown) {
        log.error({
          message: "Error getting compose stack containers",
          err,
        });
        throw err;
      }
    }

    // Single Swarm Service
    try {
      const services = await scopedDocker.listServices({
        filters: JSON.stringify({
          name: [nameFilter],
          label: [`com.upstand.resource-id=${resource.id}`],
        }),
      });
      if (services.length === 0) {
        return [];
      }

      const s = services.at(0);
      if (!s) {
        return [];
      }
      const serviceName = s.Spec?.Name || "";
      const tasks = await scopedDocker.listTasks({
        filters: JSON.stringify({
          service: [serviceName],
          "desired-state": ["running"],
        }),
      });

      const nodes = await scopedDocker.listNodes().catch(() => []);
      const nodeMap = new Map(
        nodes.map((n) => [n.ID, n.Description?.Hostname || n.ID]),
      );

      return tasks
        .filter((task) => Boolean(task.Status?.State || task.DesiredState))
        .map((task) => {
          const nodeName = nodeMap.get(task.NodeID) || task.NodeID || "local";
          const ports =
            s.Endpoint?.Ports?.map(
              (p) => `${p.PublishedPort}:${p.TargetPort}`,
            ).join(", ") || "N/A";
          return {
            id: (
              task.Status?.ContainerStatus?.ContainerID || task.ID
            ).substring(0, 64),
            name: `${serviceName}.${task.Slot || 1}`,
            status: task.Status?.State || "unknown",
            ports,
            node: nodeName,
          };
        });
    } catch (err: unknown) {
      log.error({
        message: "Error getting service containers",
        err,
      });
      throw err;
    }
  }

  /**
   * Returns DNS names that Caddy can reach over Upstand's attachable overlay
   * network. Compose stacks expose their individual Swarm service names.
   */
  async getRoutingServices(resource: Resource): Promise<string[]> {
    const resourceName = this.sanitizeName(resource.appName || resource.name);
    const scopedDocker =
      this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;
    try {
      if (resource.type === "compose" && resource.composeType === "compose") {
        const containers = await scopedDocker.listContainers({
          all: true,
          filters: JSON.stringify({
            label: [
              `com.docker.compose.project=${resourceName}`,
              `com.upstand.resource-id=${resource.id}`,
            ],
          }),
        });
        return [
          ...new Set(
            containers
              .map(
                (container) =>
                  container.Labels?.["com.docker.compose.service"] ||
                  container.Names?.[0]?.replace(/^\//, ""),
              )
              .filter((name): name is string => Boolean(name)),
          ),
        ].sort();
      }

      const services = await scopedDocker.listServices(
        resource.type === "compose"
          ? {
              filters: JSON.stringify({
                label: [
                  `com.docker.stack.namespace=${resourceName}`,
                  `com.upstand.resource-id=${resource.id}`,
                ],
              }),
            }
          : {
              filters: JSON.stringify({
                name: [resourceName],
                label: [`com.upstand.resource-id=${resource.id}`],
              }),
            },
      );

      const names = services
        .map((service) => service.Spec?.Name)
        .filter((name): name is string => Boolean(name));

      // A resource can be configured before its first deployment. The default
      // Swarm service name is still a valid future target in that case.
      return resource.type === "compose"
        ? [...new Set(names)].sort()
        : [...new Set([resourceName, ...names])].sort();
    } catch (error: unknown) {
      log.error({
        message: "Failed to discover Caddy routing services",
        resourceId: resource.id,
        err: error,
      });
      return resource.type === "compose" ? [] : [resourceName];
    }
  }

  async getLogs(
    resource: Resource,
    containerId?: string,
    tail = 150,
    since?: number,
    filter?: { search?: string; levels?: DockerLogLevel[] },
  ): Promise<string> {
    const serviceName = this.sanitizeName(resource.appName || resource.name);
    const scopedDocker =
      this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;
    try {
      if (containerId) {
        // Fetch logs for a specific Swarm task/container
        const task = await scopedDocker
          .getTask(containerId)
          .inspect()
          .catch(() => null);
        if (task?.Status?.ContainerStatus?.ContainerID) {
          const container = scopedDocker.getContainer(
            task.Status.ContainerStatus.ContainerID,
          );
          try {
            const buffer = await container.logs({
              stdout: true,
              stderr: true,
              tail,
              timestamps: true,
              ...(since ? { since } : {}),
            });
            return filterDockerLogs(this.cleanDockerLogs(buffer), filter ?? {});
          } catch (err: unknown) {
            return `No logs found for container task: ${errorMessage(err)}`;
          }
        }

        // Try raw container ID
        try {
          const container = scopedDocker.getContainer(containerId);
          const buffer = await container.logs({
            stdout: true,
            stderr: true,
            tail,
            timestamps: true,
            ...(since ? { since } : {}),
          });
          if (buffer) {
            return filterDockerLogs(this.cleanDockerLogs(buffer), filter ?? {});
          }
        } catch (err: unknown) {
          return `No logs found for container: ${errorMessage(err)}`;
        }
      }

      // Default to combined/multiplexed logs if no specific containerId is requested
      const containers = await this.getContainers(resource);
      if (containers.length > 0) {
        const results = await mapWithConcurrency(containers, async (con) => {
          try {
            const rawLogs = await this.getLogs(
              resource,
              con.id,
              tail,
              since,
              undefined,
            );
            return rawLogs
              .split(/\r?\n/)
              .filter(Boolean)
              .map((line) => {
                const separator = line.search(/\s/);
                const timestamp = separator > 0 ? line.slice(0, separator) : "";
                const hasIsoShape =
                  timestamp.length >= 20 &&
                  timestamp[4] === "-" &&
                  timestamp[7] === "-" &&
                  timestamp[10] === "T";
                if (hasIsoShape) {
                  const message = line.slice(separator).trimStart();
                  return {
                    timestamp,
                    line: `${timestamp} [${con.name}] ${message}`,
                  };
                }
                return {
                  timestamp: "",
                  line: `[${con.name}] ${line}`,
                };
              });
          } catch (err: unknown) {
            return [
              {
                timestamp: "",
                line: `[${con.name}] Error fetching logs: ${errorMessage(err)}`,
              },
            ];
          }
        });
        const allLines = results.flat();

        // Sort chronologically. If timestamp is missing, place it at the end.
        allLines.sort((a, b) => {
          if (!a.timestamp && !b.timestamp) return 0;
          if (!a.timestamp) return 1;
          if (!b.timestamp) return -1;
          return a.timestamp.localeCompare(b.timestamp);
        });

        const slicedLines = allLines.slice(-tail);
        const combinedLogs = slicedLines.map((item) => item.line).join("\n");
        return filterDockerLogs(combinedLogs, filter ?? {});
      }

      return `No active containers found. The service '${serviceName}' may not be deployed yet, is starting up, or is stopped.`;
    } catch (err: unknown) {
      return `Failed to fetch logs: ${errorMessage(err)}`;
    }
  }

  private cleanDockerLogs(buffer: Buffer | string): string {
    return cleanDockerLogs(buffer);
  }

  private async upsertService(
    serviceName: string,
    spec: Docker.CreateServiceOptions,
    authconfig?: Docker.AuthConfig,
    targetDocker?: DockerApiTarget,
    resourceId?: string,
  ): Promise<void> {
    const typedRegistryAuth =
      authconfig &&
      "username" in authconfig &&
      "password" in authconfig &&
      typeof authconfig.username === "string" &&
      typeof authconfig.password === "string"
        ? {
            username: authconfig.username,
            password: authconfig.password,
            ...(typeof authconfig.serveraddress === "string" &&
            authconfig.serveraddress
              ? { serveraddress: authconfig.serveraddress }
              : {}),
          }
        : undefined;
    if (
      !targetDocker &&
      Object.keys(this.commandEnvironment).length === 0 &&
      (!authconfig || typedRegistryAuth !== undefined) &&
      resourceId &&
      this.resourceCommandBroker?.upsertResourceService
    ) {
      await this.resourceCommandBroker.upsertResourceService(
        { kind: "local", name: "local" },
        resourceId,
        serviceName,
        spec as unknown as Record<string, unknown>,
        ...(typedRegistryAuth ? [{ registryAuth: typedRegistryAuth }] : []),
      );
      return;
    }
    const docker = targetDocker
      ? requireDockerTarget(targetDocker)
      : this.docker;
    const scopedDocker = targetDocker
      ? docker
      : resourceId
        ? (this.resourceScopedDockerFactory?.(resourceId) ?? docker)
        : docker;
    try {
      const service = scopedDocker.getService(serviceName);
      const inspect = await service.inspect();
      log.info({
        message: `Updating existing Swarm service '${serviceName}'...`,
      });
      await service.update({
        ...(authconfig ? { authconfig } : {}),
        version: inspect.Version.Index,
        Name: serviceName,
        TaskTemplate: spec.TaskTemplate,
        EndpointSpec: spec.EndpointSpec,
      });
    } catch (err: unknown) {
      if (errorStatusCode(err) === 404) {
        log.info({ message: `Creating new Swarm service '${serviceName}'...` });
        await scopedDocker.createService(authconfig ?? {}, spec);
      } else {
        throw err;
      }
    }
  }

  /**
   * Reconcile the network separately from the service spec update. Existing
   * services may have been created before the shared overlay was introduced,
   * and Docker does not retroactively attach those tasks when only the image
   * or environment changes.
   */
  private async ensureServiceNetwork(
    serviceName: string,
    networkId: string,
    targetDocker?: DockerApiTarget,
    resourceId?: string,
  ): Promise<void> {
    if (
      !targetDocker &&
      Object.keys(this.commandEnvironment).length === 0 &&
      resourceId &&
      this.resourceCommandBroker?.ensureResourceServiceNetwork
    ) {
      await this.resourceCommandBroker.ensureResourceServiceNetwork(
        { kind: "local", name: "local" },
        resourceId,
        serviceName,
        networkId,
      );
      return;
    }
    const docker = targetDocker
      ? requireDockerTarget(targetDocker)
      : this.docker;
    const scopedDocker = targetDocker
      ? docker
      : resourceId
        ? (this.resourceScopedDockerFactory?.(resourceId) ?? docker)
        : docker;
    const service = scopedDocker.getService(serviceName);
    const inspect = await service.inspect();
    const networks =
      inspect.Spec?.TaskTemplate?.Networks || inspect.Spec?.Networks || [];
    if (
      networks.some(
        (network: { Target?: string }) => network.Target === networkId,
      )
    ) {
      return;
    }

    log.warn({
      message: `Attaching existing Swarm service '${serviceName}' to the Upstand overlay network.`,
      networkId,
    });
    await service.update({
      version: inspect.Version.Index,
      Name: serviceName,
      Mode: inspect.Spec.Mode,
      TaskTemplate: {
        ...inspect.Spec.TaskTemplate,
        Networks: [...networks, { Target: networkId }],
      },
      EndpointSpec: inspect.Spec.EndpointSpec,
      UpdateConfig: inspect.Spec.UpdateConfig,
      RollbackConfig: inspect.Spec.RollbackConfig,
    });
  }

  private runCommandAsync(
    cmd: string,
    args: string[],
    onLog: (log: string) => void,
    env?: NodeJS.ProcessEnv,
    options: {
      stdin?: string;
      redactions?: readonly string[];
      resourceId?: string;
      timeoutMs?: number;
    } = {},
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let cancelled = false;
      const startedAt = Date.now();
      const p = spawn(cmd, args, {
        shell: false,
        env: {
          ...getInheritedEnv(),
          ...this.commandEnvironment,
          ...(env ?? {}),
          ...(cmd === "docker" && options.resourceId
            ? this.getDockerCommandEnvironment(options.resourceId)
            : {}),
        },
      });

      if (options.stdin !== undefined) p.stdin.end(options.stdin);

      const cancellationTimer = this.cancellationKey
        ? setInterval(() => {
            if (!this.cancellationKey) return;
            void redis.get(this.cancellationKey).then((requested) => {
              if (requested && !settled) {
                cancelled = true;
                p.kill("SIGTERM");
              }
            });
          }, 500)
        : null;
      const timeoutTimer = options.timeoutMs
        ? setTimeout(() => {
            if (settled) return;
            cancelled = true;
            p.kill("SIGTERM");
          }, options.timeoutMs)
        : null;

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (cancellationTimer) clearInterval(cancellationTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        callback();
      };

      p.stdout.on("data", (data) => {
        onLog(redactCommandOutput(data.toString(), options.redactions ?? []));
      });

      p.stderr.on("data", (data) => {
        onLog(redactCommandOutput(data.toString(), options.redactions ?? []));
      });

      p.on("close", (code) => {
        finish(() => {
          if (cancelled) {
            reject(
              new Error(
                options.timeoutMs && Date.now() >= startedAt + options.timeoutMs
                  ? `Command '${cmd}' timed out after ${Math.ceil(options.timeoutMs / 1000)} seconds`
                  : "Deployment cancellation requested",
              ),
            );
          } else if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Command '${cmd}' failed with exit code ${code}`));
          }
        });
      });

      p.on("error", (err) => {
        finish(() => {
          reject(err);
        });
      });
    });
  }

  async getContainerStats(
    containerId: string,
    resolveSwarmTask = true,
  ): Promise<ContainerRuntimeStats> {
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      DOCKER_STATS_TIMEOUT_MS,
    );
    try {
      let realContainerId = containerId;

      // listContainers already returns real Docker container IDs. The task
      // lookup is only needed by callers that pass a Swarm task ID; skipping
      // it for running-container inventory avoids a global Swarm task scan per
      // container and keeps runtime dashboards responsive on local Docker.
      if (resolveSwarmTask) {
        const tasks = await this.docker
          .listTasks({
            filters: JSON.stringify({ id: [containerId] }),
          })
          .catch(() => []);

        if (tasks.length > 0 && tasks[0].Status?.ContainerStatus?.ContainerID) {
          realContainerId = tasks[0].Status.ContainerStatus.ContainerID;
        } else {
          const allTasks = await this.docker.listTasks().catch(() => []);
          const matchingTask = allTasks.find((t) =>
            t.ID.startsWith(containerId),
          );
          if (matchingTask?.Status?.ContainerStatus?.ContainerID) {
            realContainerId = matchingTask.Status.ContainerStatus.ContainerID;
          }
        }
      }

      const container = this.docker.getContainer(realContainerId);
      const stats = (await container.stats({
        stream: false,
        abortSignal: abortController.signal,
      } as never)) as unknown as Docker.ContainerStats;

      let cpuPercent = 0;
      if (stats.cpu_stats && stats.precpu_stats) {
        const cpuDelta =
          stats.cpu_stats.cpu_usage.total_usage -
          stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta =
          stats.cpu_stats.system_cpu_usage -
          stats.precpu_stats.system_cpu_usage;
        const cpus =
          stats.cpu_stats.online_cpus ||
          stats.cpu_stats.cpu_usage.percpu_usage?.length ||
          1;
        if (systemDelta > 0 && cpuDelta > 0) {
          cpuPercent = (cpuDelta / systemDelta) * cpus * 100;
        }
      }

      let ramUsage = 0;
      let ramLimit = 0;
      let ramPercent = 0;
      if (stats.memory_stats) {
        ramUsage = stats.memory_stats.usage || 0;
        ramLimit = stats.memory_stats.limit || 1;
        ramPercent = (ramUsage / ramLimit) * 100;
      }

      const networkTotals = Object.values(stats.networks || {}).reduce(
        (total, network) => ({
          rx: total.rx + network.rx_bytes,
          tx: total.tx + network.tx_bytes,
        }),
        { rx: 0, tx: 0 },
      );

      return {
        cpu: Number.parseFloat(cpuPercent.toFixed(2)),
        ram: Number.parseFloat(ramPercent.toFixed(2)),
        ramUsage: Math.round(ramUsage / (1024 * 1024)),
        ramLimit: Math.round(ramLimit / (1024 * 1024)),
        networkRxBytes: networkTotals.rx,
        networkTxBytes: networkTotals.tx,
      };
    } catch (err: unknown) {
      log.error({
        message: "Failed to fetch container stats",
        err,
      });
      return {
        cpu: 0,
        ram: 0,
        ramUsage: 0,
        ramLimit: 0,
        networkRxBytes: 0,
        networkTxBytes: 0,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async getServerRuntimeStats(): Promise<ServerRuntimeStats> {
    const [rawInfo, containers, rawDiskUsage] = await Promise.all([
      this.docker.info() as Promise<unknown>,
      this.docker.listContainers({ all: false }),
      this.getDockerDiskUsage(),
    ]);
    const info = isUnknownRecord(rawInfo) ? rawInfo : {};
    const diskUsage = isUnknownRecord(rawDiskUsage) ? rawDiskUsage : {};
    const containerStats = await mapWithConcurrency(containers, (container) =>
      this.getContainerStats(container.Id, false),
    );
    const totals = containerStats.reduce<ContainerRuntimeStats>(
      (aggregate, current) => ({
        cpu: aggregate.cpu + current.cpu,
        ram: 0,
        ramUsage: aggregate.ramUsage + current.ramUsage,
        ramLimit: aggregate.ramLimit + current.ramLimit,
        networkRxBytes: aggregate.networkRxBytes + current.networkRxBytes,
        networkTxBytes: aggregate.networkTxBytes + current.networkTxBytes,
      }),
      {
        cpu: 0,
        ram: 0,
        ramUsage: 0,
        ramLimit: 0,
        networkRxBytes: 0,
        networkTxBytes: 0,
      },
    );
    const memoryTotal = Math.round(
      numberValue(info, "MemTotal") / (1024 * 1024),
    );

    return {
      collectedAt: new Date().toISOString(),
      serverName: stringValue(info, "Name"),
      dockerVersion: stringValue(info, "ServerVersion"),
      operatingSystem: stringValue(info, "OperatingSystem"),
      kernelVersion: stringValue(info, "KernelVersion"),
      architecture: stringValue(info, "Architecture"),
      cpu: Number.parseFloat(totals.cpu.toFixed(2)),
      cpuCores: numberValue(info, "NCPU"),
      memoryUsage: totals.ramUsage,
      memoryTotal,
      memoryPercent:
        memoryTotal > 0
          ? Number.parseFloat(
              ((totals.ramUsage / memoryTotal) * 100).toFixed(2),
            )
          : 0,
      activeContainers: containers.length,
      networkRxBytes: totals.networkRxBytes,
      networkTxBytes: totals.networkTxBytes,
      dockerImageBytes: sumDockerUsage(diskUsage.Images),
      dockerContainerBytes: sumDockerUsage(diskUsage.Containers),
      dockerVolumeBytes: sumDockerUsage(diskUsage.Volumes),
      dockerBuildCacheBytes: sumDockerUsage(diskUsage.BuildCache),
    };
  }

  private async getDockerDiskUsage(): Promise<unknown> {
    if (!this.cacheDockerDiskUsage) {
      return this.docker.df();
    }

    const now = Date.now();
    if (this.dockerDiskUsage && now - this.dockerDiskUsageUpdatedAt < 60_000) {
      return this.dockerDiskUsage;
    }

    if (!this.dockerDiskUsageRefresh) {
      this.dockerDiskUsageRefresh = this.docker
        .df()
        .then((value) => {
          this.dockerDiskUsage = isUnknownRecord(value) ? value : {};
          this.dockerDiskUsageUpdatedAt = Date.now();
        })
        .catch((error: unknown) => {
          log.warn({
            message: "Failed to refresh Docker disk usage",
            err: error,
          });
        })
        .finally(() => {
          this.dockerDiskUsageRefresh = undefined;
        });
    }

    return this.dockerDiskUsage ?? {};
  }

  async removeResource(
    resource: Resource,
    deleteVolumes = false,
  ): Promise<void> {
    const serviceName = this.sanitizeName(resource.appName || resource.name);
    const scopedDocker =
      this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;

    if (resource.type === "compose") {
      const removeResourceCompose =
        this.resourceCommandBroker?.removeResourceCompose;
      try {
        if (removeResourceCompose) {
          await removeResourceCompose(
            { kind: "local", name: "local" },
            resource.id,
            serviceName,
            resource.composeType === "compose" ? "compose" : "stack",
            deleteVolumes,
          );
        } else if (resource.composeType === "compose") {
          const containers = await scopedDocker.listContainers({
            all: true,
            filters: JSON.stringify({
              label: [
                `com.docker.compose.project=${serviceName}`,
                `com.upstand.resource-id=${resource.id}`,
              ],
            }),
          });
          await mapWithConcurrency(containers, (container) =>
            scopedDocker
              .getContainer(container.Id)
              .remove({ force: true })
              .catch(() => undefined),
          );
        } else {
          await this.runCommandAsync(
            "docker",
            ["stack", "rm", serviceName],
            () => {},
          );
        }

        const containerLabel =
          resource.composeType === "compose"
            ? `com.docker.compose.project=${serviceName}`
            : `com.docker.stack.namespace=${serviceName}`;
        await this.waitForManagedContainersGone(containerLabel, resource.id);
      } catch (err: unknown) {
        log.error({
          message: `Failed to remove Compose resource ${serviceName}`,
          err,
        });
      }

      if (deleteVolumes && !removeResourceCompose) {
        try {
          const volumesList = await scopedDocker.listVolumes();
          const volumes = volumesList.Volumes || [];
          for (const vol of volumes) {
            if (vol.Name.startsWith(`${serviceName}_`)) {
              await scopedDocker
                .getVolume(vol.Name)
                .remove()
                .catch(() => {});
            }
          }
        } catch (err: unknown) {
          log.error({
            message: "Failed to clean up compose stack volumes",
            err,
          });
        }
      }
      await this.removeResourceNetwork(resource);
      return;
    }

    try {
      const removeResourceService =
        this.resourceCommandBroker?.removeResourceService;
      if (removeResourceService) {
        await removeResourceService(
          { kind: "local", name: "local" },
          resource.id,
          serviceName,
        );
      } else {
        const service = scopedDocker.getService(serviceName);
        await service.remove();
      }
    } catch (err: unknown) {
      if (errorStatusCode(err) !== 404) {
        log.error({
          message: `Failed to remove Swarm service ${serviceName}`,
          err,
        });
      }
    }

    await this.waitForManagedContainersGone(
      `com.docker.swarm.service.name=${serviceName}`,
      resource.id,
    );

    if (deleteVolumes) {
      try {
        const volumeName = `upstand-db-data-${resource.id}`;
        const removeResourceVolume =
          this.resourceCommandBroker?.removeResourceVolume;
        if (removeResourceVolume) {
          await removeResourceVolume(
            { kind: "local", name: "local" },
            resource.id,
            volumeName,
          );
        } else {
          const volume = scopedDocker.getVolume(volumeName);
          await volume.remove().catch(() => {});
        }
      } catch (err: unknown) {
        log.error({
          message: `Failed to remove volume for resource ${resource.id}`,
          err,
        });
      }
    }

    await this.removeResourceNetwork(resource);
  }

  /**
   * Permanently removes a database service and its managed data volume.
   *
   * Database rebuilds use this strict variant instead of removeResource,
   * whose best-effort cleanup semantics are appropriate for ordinary resource
   * deletion but could otherwise allow a rebuild to continue after stale data
   * survived removal.
   */
  async removeDatabase(resource: Resource): Promise<void> {
    if (resource.type !== "database") {
      throw new Error("Only database resources can be rebuilt");
    }

    const serviceName = this.sanitizeName(resource.appName || resource.name);
    const scopedDocker =
      this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;
    try {
      const removeResourceService =
        this.resourceCommandBroker?.removeResourceService;
      if (removeResourceService) {
        await removeResourceService(
          { kind: "local", name: "local" },
          resource.id,
          serviceName,
        );
      } else {
        await scopedDocker.getService(serviceName).remove();
      }
    } catch (error: unknown) {
      if (errorStatusCode(error) !== 404) throw error;
    }

    // Swarm acknowledges service removal before the task container has
    // stopped. Wait for that container to disappear before removing the
    // managed volume; otherwise rebuilds intermittently fail with Docker's
    // "volume is in use" conflict.
    await this.waitForManagedContainersGone(
      `com.docker.swarm.service.name=${serviceName}`,
      resource.id,
    );

    const volumeName = `upstand-db-data-${resource.id}`;
    try {
      const removeResourceVolume =
        this.resourceCommandBroker?.removeResourceVolume;
      if (removeResourceVolume) {
        await removeResourceVolume(
          { kind: "local", name: "local" },
          resource.id,
          volumeName,
        );
      } else {
        await scopedDocker.getVolume(volumeName).remove();
      }
    } catch (error: unknown) {
      if (errorStatusCode(error) !== 404) throw error;
    }

    await this.removeResourceNetwork(resource);
  }

  private async waitForManagedContainersGone(
    label: string,
    resourceId: string,
  ): Promise<void> {
    const scopedDocker =
      this.resourceScopedDockerFactory?.(resourceId) ?? this.docker;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const containers = await scopedDocker.listContainers({
        all: true,
        filters: JSON.stringify({
          label: [label, `com.upstand.resource-id=${resourceId}`],
        }),
      });
      if (containers.length === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    log.warn({
      message: "Timed out waiting for managed Docker containers to stop",
      label,
    });
  }

  private async removeResourceNetwork(resource: Resource): Promise<void> {
    const advancedConfig = parseResourceAdvancedConfig(resource.advancedConfig);
    if (!advancedConfig.isolatedDeployment) return;

    const removeTypedResourceNetwork =
      this.resourceCommandBroker?.removeResourceNetwork;
    if (removeTypedResourceNetwork) {
      try {
        await removeTypedResourceNetwork(
          { kind: "local", name: "local" },
          resource.id,
          getResourceOverlayNetworkName(resource.id),
        );
        log.info({
          message: `Removed isolated network for resource '${resource.id}'.`,
          network: getResourceOverlayNetworkName(resource.id),
        });
      } catch (error: unknown) {
        log.warn({
          message: `Isolated network for resource '${resource.id}' could not be removed by the typed Docker capability.`,
          network: getResourceOverlayNetworkName(resource.id),
          err: error,
        });
      }
      return;
    }

    const scopedDocker =
      this.resourceScopedDockerFactory?.(resource.id) ?? this.docker;
    const network = scopedDocker.getNetwork(
      getResourceOverlayNetworkName(resource.id),
    );
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await network.remove();
        log.info({
          message: `Removed isolated network for resource '${resource.id}'.`,
          network: getResourceOverlayNetworkName(resource.id),
        });
        return;
      } catch (error: unknown) {
        if (errorStatusCode(error) === 404) return;
        if (errorStatusCode(error) !== 409 || attempt === 9) {
          log.warn({
            message: `Isolated network for resource '${resource.id}' could not be removed yet.`,
            network: getResourceOverlayNetworkName(resource.id),
            err: error,
          });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  async runCommandInResourceContainer(
    resource: Resource,
    command: string,
    targetDocker?: DockerApiTarget,
    options?: {
      timeoutSeconds?: number;
      maxOutputBytes?: number;
    },
  ): Promise<string> {
    if (
      !command ||
      command.length > MAX_RESOURCE_COMMAND_BYTES ||
      command.includes("\0")
    ) {
      throw new Error(
        `Container command must be non-empty, contain no NUL bytes, and be at most ${MAX_RESOURCE_COMMAND_BYTES} bytes`,
      );
    }
    const timeoutSeconds = Math.min(
      1_800,
      Math.max(
        1,
        Math.floor(
          options?.timeoutSeconds ?? DEFAULT_CONTAINER_COMMAND_TIMEOUT_SECONDS,
        ),
      ),
    );
    const maxOutputBytes = Math.min(
      MAX_CONTAINER_COMMAND_OUTPUT_BYTES,
      Math.max(
        1_024,
        Math.floor(
          options?.maxOutputBytes ?? MAX_CONTAINER_COMMAND_OUTPUT_BYTES,
        ),
      ),
    );

    if (
      !targetDocker &&
      this.commandEnvironment &&
      Object.keys(this.commandEnvironment).length === 0 &&
      this.resourceCommandBroker
    ) {
      const result = await this.resourceCommandBroker.execContainerCommand(
        { kind: "local", name: "local" },
        undefined,
        command,
        { timeoutSeconds, maxOutputBytes },
        resource.id,
      );
      if (result.exitCode !== undefined && result.exitCode !== 0) {
        throw new Error(
          result.stderr?.trim() ||
            `Container command exited with code ${result.exitCode}`,
        );
      }
      return this.cleanDockerLogs(result.output).trim();
    }

    const docker = targetDocker
      ? requireDockerTarget(targetDocker)
      : (this.resourceScopedDockerFactory?.(resource.id) ?? this.docker);
    const containers = await this.getContainers(resource);
    if (containers.length === 0) {
      throw new Error(
        `No running containers found for resource '${resource.name}'`,
      );
    }

    const firstContainer = containers.at(0);
    if (!firstContainer) {
      throw new Error(
        `No running containers found for resource '${resource.name}'`,
      );
    }
    const containerId = firstContainer.id;

    const container = docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: ["sh", "-c", command],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ Detach: false });
    const chunks: Buffer[] = [];

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let outputBytes = 0;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        stopReadableStream(stream);
        reject(
          new Error(
            `Container command execution timed out after ${timeoutSeconds}s`,
          ),
        );
      }, timeoutSeconds * 1_000);
      timer.unref?.();

      stream.on("data", (chunk: Buffer | string) => {
        if (settled) return;
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        outputBytes += buffer.byteLength;
        if (outputBytes > maxOutputBytes) {
          settled = true;
          clearTimeout(timer);
          stopReadableStream(stream);
          reject(
            new Error(
              `Container command output exceeded the ${maxOutputBytes}-byte limit`,
            ),
          );
          return;
        }
        chunks.push(buffer);
      });
      stream.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void exec
          .inspect()
          .then((inspection) => {
            const exitCode = inspection.ExitCode ?? 0;
            if (exitCode !== 0) {
              reject(
                new Error(`Container command exited with code ${exitCode}`),
              );
              return;
            }
            resolve(this.cleanDockerLogs(Buffer.concat(chunks)).trim());
          })
          .catch((error: unknown) => {
            reject(
              new Error(
                `Unable to inspect container command result: ${error instanceof Error ? error.message : String(error)}`,
              ),
            );
          });
      });
      stream.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async execContainerCommand(
    _target: DockerInspectionTarget,
    serviceName: string,
    command: string,
    options?: { timeoutSeconds?: number; onLog?: (chunk: string) => void },
    _resourceId?: string,
  ): Promise<{ output: string; stderr?: string; exitCode: number }> {
    const scopedDocker = _resourceId
      ? (this.resourceScopedDockerFactory?.(_resourceId) ?? this.docker)
      : this.docker;
    const list = await scopedDocker.listContainers({
      all: false,
      ...(_resourceId
        ? {
            filters: JSON.stringify({
              label: [`com.upstand.resource-id=${_resourceId}`],
            }),
          }
        : {}),
    });
    const normalizedServiceName = serviceName.replace(/^\/+/, "");
    const containerInfo = list.find(
      (c) =>
        c.Names?.some((n) => {
          const normalizedName = n.replace(/^\/+/, "");
          return (
            normalizedName === normalizedServiceName ||
            normalizedName.startsWith(`${normalizedServiceName}.`)
          );
        }) ||
        c.Labels?.["com.docker.swarm.service.name"] === normalizedServiceName ||
        c.Labels?.["com.docker.compose.service"] === normalizedServiceName,
    );
    if (!containerInfo) {
      throw new Error(
        `No running container found for service '${serviceName}'`,
      );
    }

    const container = scopedDocker.getContainer(containerInfo.Id);
    const exec = await container.exec({
      Cmd: ["sh", "-c", command],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ Detach: false });
    const stdoutChunks: Buffer[] = [];
    const timeoutMs = (options?.timeoutSeconds ?? 300) * 1000;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let outputBytes = 0;
      const timer = setTimeout(() => {
        settled = true;
        try {
          stopReadableStream(stream);
        } catch {}
        reject(
          new Error(
            `Container command execution timed out after ${options?.timeoutSeconds ?? 300}s`,
          ),
        );
      }, timeoutMs);

      stream.on("data", (chunk: Buffer | string) => {
        if (settled) return;
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        outputBytes += buf.byteLength;
        if (outputBytes > MAX_CONTAINER_COMMAND_OUTPUT_BYTES) {
          settled = true;
          clearTimeout(timer);
          stopReadableStream(stream);
          reject(
            new Error(
              `Container command output exceeded the ${MAX_CONTAINER_COMMAND_OUTPUT_BYTES}-byte limit`,
            ),
          );
          return;
        }
        stdoutChunks.push(buf);
        if (options?.onLog) {
          const cleaned = this.cleanDockerLogs(buf);
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

    const cleanOutput = this.cleanDockerLogs(
      Buffer.concat(stdoutChunks),
    ).trim();
    const inspect = await exec.inspect();
    const exitCode = inspect.ExitCode ?? 0;

    return { output: cleanOutput, stderr: "", exitCode };
  }

  async transferImage(
    imageName: string,
    targetDocker: DockerApiTarget,
    onLog?: (log: string) => void,
  ): Promise<void> {
    if (!targetDocker || targetDocker === this.docker) {
      onLog?.(
        `Image '${imageName}' is already present on target production server. ✅\n`,
      );
      return;
    }
    onLog?.(
      `Transferring image '${imageName}' to target production server...\n`,
    );
    try {
      const image = this.docker.getImage(imageName);
      const stream = await image.get();
      const responseStream =
        await requireDockerImageTarget(targetDocker).loadImage(stream);
      if (responseStream && typeof responseStream.on === "function") {
        await new Promise<void>((resolve, reject) => {
          responseStream.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf-8");
            onLog?.(text);
          });
          responseStream.on("end", resolve);
          responseStream.on("error", reject);
          responseStream.resume();
        });
      }
      onLog?.(`Image '${imageName}' transferred successfully! ✅\n`);
    } catch (err: unknown) {
      log.error({
        message: "Failed to transfer image between Docker daemons",
        imageName,
        err,
      });
      throw new Error(
        `Failed to transfer image '${imageName}': ${errorMessage(err)}`,
      );
    }
  }

  async waitForServiceConvergence(
    resource: Resource,
    options: ConvergenceOptions = {},
  ): Promise<ConvergenceResult> {
    const serviceName = this.sanitizeName(
      options.serviceNameOverride || resource.appName || resource.name,
    );
    const docker = options.destinationDocker
      ? requireDockerTarget(options.destinationDocker)
      : (this.resourceScopedDockerFactory?.(resource.id) ?? this.docker);
    const timeoutSeconds = options.timeoutSeconds ?? 60;
    const stabilityWindowSeconds = options.stabilityWindowSeconds ?? 5;
    const onLog = options.onLog;

    onLog?.(
      `Verifying service convergence for '${serviceName}' (timeout: ${timeoutSeconds}s)...\n`,
    );

    const startTime = Date.now();
    const timeoutMs = timeoutSeconds * 1000;
    const stabilityMs = stabilityWindowSeconds * 1000;
    let healthyStartTime: number | null = null;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const useTypedConvergenceBroker =
          !options.destinationDocker &&
          Object.keys(this.commandEnvironment).length === 0 &&
          this.resourceCommandBroker &&
          Boolean(resource.id);
        const tasks: DockerTaskSnapshot[] = useTypedConvergenceBroker
          ? (
              await this.resourceCommandBroker.inspectResourceConvergence(
                { kind: "local", name: "local" },
                resource.id,
                serviceName,
              )
            ).tasks.map((task) => ({
              DesiredState: task.desiredState,
              Status: {
                State: task.state,
                Err: task.error,
                Health: task.health,
                ContainerStatus: task.containerId
                  ? { ContainerID: task.containerId }
                  : undefined,
              },
            }))
          : (
              await docker.listTasks({
                filters: JSON.stringify({
                  service: [serviceName],
                  "desired-state": ["running"],
                }),
              })
            )
              .map((task: unknown): DockerTaskSnapshot | null =>
                parseDockerTask(task),
              )
              .filter(
                (task: DockerTaskSnapshot | null): task is DockerTaskSnapshot =>
                  task !== null,
              );

        if (!Array.isArray(tasks) || tasks.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        const activeTasks = tasks.filter(
          (t: DockerTaskSnapshot) =>
            t.Status?.State === "running" || t.Status?.State === "starting",
        );

        const failedTasks = tasks.filter(
          (t: DockerTaskSnapshot) =>
            t.Status?.State === "failed" ||
            t.Status?.State === "rejected" ||
            (t.Status?.State === "shutdown" && t.DesiredState !== "shutdown"),
        );

        if (failedTasks.length > 0 && activeTasks.length === 0) {
          const failureReason =
            failedTasks[0]?.Status?.Err ||
            failedTasks[0]?.Status?.State ||
            "Task failed to start";
          onLog?.(
            `Convergence check failed: Task crash loop detected (${failureReason}). ❌\n`,
          );
          return {
            healthy: false,
            state: "failed",
            message: `Task crash loop detected: ${failureReason}`,
          };
        }

        if (activeTasks.length > 0) {
          let allTasksHealthy = true;
          let explicitHealthCheckFound = false;

          for (const task of activeTasks) {
            const containerId = task.Status?.ContainerStatus?.ContainerID;
            if (containerId && !useTypedConvergenceBroker) {
              try {
                const container = docker.getContainer(containerId);
                const inspectData = await container.inspect();
                const health = inspectData.State?.Health;

                if (health && typeof health.Status === "string") {
                  explicitHealthCheckFound = true;
                  if (health.Status === "unhealthy") {
                    onLog?.(
                      `Convergence check: Container ${containerId.slice(0, 12)} reported unhealthy status. ❌\n`,
                    );
                    return {
                      healthy: false,
                      state: "unhealthy",
                      message: `Container health check failed: ${health.Status}`,
                    };
                  }
                  if (health.Status !== "healthy") {
                    allTasksHealthy = false;
                  }
                }
              } catch {
                // Container inspect might briefly fail while starting up
              }
            }

            if (
              useTypedConvergenceBroker &&
              task.Status?.Health &&
              task.Status.Health !== "none" &&
              task.Status.Health !== "unknown"
            ) {
              explicitHealthCheckFound = true;
              if (task.Status.Health === "unhealthy") {
                onLog?.(
                  `Convergence check: Container ${containerId?.slice(0, 12) ?? "unknown"} reported unhealthy status. ❌\n`,
                );
                return {
                  healthy: false,
                  state: "unhealthy",
                  message: `Container health check failed: ${task.Status.Health}`,
                };
              }
              if (task.Status.Health !== "healthy") {
                allTasksHealthy = false;
              }
            }

            if (task.Status?.State !== "running") {
              allTasksHealthy = false;
            }
          }

          if (allTasksHealthy) {
            if (explicitHealthCheckFound) {
              const smokeTest = await this.runSmokeTest(resource, onLog);
              if (smokeTest && !smokeTest.healthy) return smokeTest;
              onLog?.("Container health check passed healthy! ✅\n");
              return {
                healthy: true,
                state: "healthy",
                message: "Health check passed",
              };
            }

            if (healthyStartTime === null) {
              healthyStartTime = Date.now();
            }

            const elapsedHealthy = Date.now() - healthyStartTime;
            if (elapsedHealthy >= stabilityMs) {
              const smokeTest = await this.runSmokeTest(resource, onLog);
              if (smokeTest && !smokeTest.healthy) return smokeTest;
              onLog?.(
                `Container convergence verified (running stably for ${Math.round(elapsedHealthy / 1000)}s). ✅\n`,
              );
              return {
                healthy: true,
                state: "running",
                message: `Container running stably for ${Math.round(elapsedHealthy / 1000)}s`,
              };
            }
          } else {
            healthyStartTime = null;
          }
        }
      } catch (_err: unknown) {
        // Swarm task API call error, retry until timeout
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    onLog?.(`Convergence check timed out after ${timeoutSeconds}s. ❌\n`);
    return {
      healthy: false,
      state: "timeout",
      message: `Container failed to converge within ${timeoutSeconds} seconds`,
    };
  }

  async runPostDeploySmokeTest(
    resource: Resource,
    onLog?: (log: string) => void,
  ): Promise<ConvergenceResult | null> {
    return this.runSmokeTest(resource, onLog);
  }

  private async runSmokeTest(
    resource: Resource,
    onLog?: (log: string) => void,
  ): Promise<ConvergenceResult | null> {
    const smokeTest = parseResourceAdvancedConfig(
      resource.advancedConfig,
    ).smokeTest;
    if (!smokeTest?.enabled) return null;

    onLog?.(
      `Running ${smokeTest.type.toUpperCase()} deployment smoke test against '${smokeTest.target}'...\n`,
    );
    let lastMessage = "Smoke test failed";
    for (let attempt = 1; attempt <= smokeTest.retries; attempt += 1) {
      try {
        if (smokeTest.type === "http") {
          const target = new URL(smokeTest.target);
          if (
            !["http:", "https:"].includes(target.protocol) ||
            target.username ||
            target.password
          ) {
            throw new Error(
              "Smoke-test HTTP target must be a credential-free URL",
            );
          }
          const address = await this.assertSafeSmokeTarget(target);
          const status = await this.requestHttpSmokeTest(
            target,
            address,
            smokeTest.timeoutSeconds * 1_000,
          );
          if (status === smokeTest.expectedStatus) {
            onLog?.(`Deployment smoke test passed with HTTP ${status}. ✅\n`);
            return {
              healthy: true,
              state: "smoke-tested",
              message: "Smoke test passed",
            };
          }
          lastMessage = `Expected HTTP ${smokeTest.expectedStatus}, received ${status}`;
        } else {
          const target = smokeTest.target.startsWith("tcp://")
            ? new URL(smokeTest.target)
            : new URL(`tcp://${smokeTest.target}`);
          const port = Number(target.port);
          if (
            !target.hostname ||
            !Number.isInteger(port) ||
            port < 1 ||
            port > 65_535
          ) {
            throw new Error("TCP smoke-test target must include a valid port");
          }
          const address = await this.assertSafeSmokeTarget(target);
          await new Promise<void>((resolve, reject) => {
            const socket = net.createConnection({
              host: address,
              port,
              timeout: smokeTest.timeoutSeconds * 1_000,
            });
            const finish = (error?: Error) => {
              socket.destroy();
              error ? reject(error) : resolve();
            };
            socket.once("connect", () => finish());
            socket.once("timeout", () =>
              finish(new Error("TCP smoke test timed out")),
            );
            socket.once("error", finish);
          });
          onLog?.(
            "Deployment smoke test passed with an open TCP connection. ✅\n",
          );
          return {
            healthy: true,
            state: "smoke-tested",
            message: "Smoke test passed",
          };
        }
      } catch (error: unknown) {
        lastMessage = error instanceof Error ? error.message : String(error);
      }
      if (attempt < smokeTest.retries) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    onLog?.(`Deployment smoke test failed: ${lastMessage}. ❌\n`);
    return { healthy: false, state: "smoke-test-failed", message: lastMessage };
  }

  private async requestHttpSmokeTest(
    target: URL,
    address: string,
    timeoutMs: number,
  ): Promise<number> {
    const hostname = target.hostname.replace(/^\[|\]$/g, "");
    const port =
      Number(target.port) || (target.protocol === "https:" ? 443 : 80);
    const request = target.protocol === "https:" ? httpsRequest : httpRequest;
    const pinnedLookup: NonNullable<RequestOptions["lookup"]> = (
      _hostname,
      _options,
      callback,
    ) => {
      callback(null, address, net.isIP(address));
    };

    return await new Promise<number>((resolve, reject) => {
      const clientRequest = request(
        {
          hostname,
          port,
          method: "GET",
          path: `${target.pathname || "/"}${target.search}`,
          headers: {
            Accept: "*/*",
            Connection: "close",
            Host: target.host,
          },
          lookup: pinnedLookup,
          ...(target.protocol === "https:" ? { servername: hostname } : {}),
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      clientRequest.setTimeout(timeoutMs, () => {
        clientRequest.destroy(new Error("HTTP smoke test timed out"));
      });
      clientRequest.once("error", reject);
      clientRequest.end();
    });
  }

  private async assertSafeSmokeTarget(target: URL): Promise<string> {
    const hostname = target.hostname.replace(/^\[|\]$/g, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      isBlockedAddress(hostname)
    ) {
      throw new Error(
        "Smoke-test targets cannot address local or private networks",
      );
    }
    if (net.isIP(hostname)) return hostname;
    const addresses = await lookup(hostname, {
      all: true,
      verbatim: true,
    });
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => isBlockedAddress(address))
    ) {
      throw new Error("Smoke-test target must resolve to public addresses");
    }
    return addresses[0]?.address ?? hostname;
  }
}
