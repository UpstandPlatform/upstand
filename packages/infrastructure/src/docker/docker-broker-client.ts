import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { type Readable, Transform } from "node:stream";
import dockerIgnore from "@balena/dockerignore";
import { readDeploymentScopeHeaders } from "@upstand/platform/crypto/deployment-scope";
import type {
  CaddyConfigurationInput,
  CaddyProvisioningInput,
  CaddyProvisioningPort,
} from "@upstand/usecases/ports/caddy";
import type {
  ContainerFileItem,
  ContainerFileSystemPort,
  ContainerVolumeMount,
} from "@upstand/usecases/ports/container-file-system";
import type {
  DockerCleanupPort,
  DockerContainer,
  DockerContainerCommand,
  DockerContainerControllerPort,
  DockerContainerStats,
  DockerImage,
  DockerInfo,
  DockerInspectionTarget,
  DockerInventoryReaderPort,
  DockerLogRequest,
  DockerNetwork,
  DockerPruneOptions,
  DockerPrunePort,
  DockerPruneType,
  DockerResourceCommand,
  DockerResourceControllerPort,
  DockerSelfUpdateInput,
  DockerServiceSummary,
  DockerVolume,
  DockerWebServerMaintenancePort,
} from "@upstand/usecases/ports/docker";
import type {
  DockerSwarmInfoPort,
  DockerSwarmInspectionPort,
  DockerSwarmManagementPort,
  DockerSwarmNodePort,
  DockerSwarmServicePort,
  DockerSwarmTaskPort,
} from "@upstand/usecases/ports/swarm";
import {
  cleanDockerLogs,
  filterDockerLogs,
} from "@upstand/usecases/resource/docker-log-filter";
// tar-fs is CommonJS and does not ship TypeScript declarations. Keep the
// runtime import static so Bun includes it in compiled Desktop executables,
// while constraining the small API used by this adapter locally.
// @ts-expect-error tar-fs has no bundled declaration file.
import tarFsModule from "tar-fs";
import { z } from "zod";
import {
  readDockerBrokerTLSFile,
  readDockerBrokerToken,
} from "./docker-client";

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const BUILD_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_BUILD_CONTEXT_BYTES = 512 * 1024 * 1024;
const MAX_BUILD_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_REGISTRY_AUTH_BYTES = 16 * 1024;
const TYPED_RESOURCE_IMAGE_REFERENCE_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._/@:-]{0,510}$/;

type TarFsModule = {
  pack: (
    cwd: string,
    options?: {
      ignore?: (absolutePath: string) => boolean;
    },
  ) => Readable;
};

const tarFs = tarFsModule as unknown as TarFsModule;

function encodeTypedRegistryAuth(auth: {
  username: string;
  password: string;
  serveraddress?: string;
}): string {
  const values = [auth.username, auth.password, auth.serveraddress].filter(
    (value): value is string => value !== undefined,
  );
  if (
    auth.username.length === 0 ||
    auth.password.length === 0 ||
    values.some(
      (value) =>
        value.length > 4096 ||
        [...value].some(
          (character) =>
            character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f,
        ),
    )
  ) {
    throw new Error("Typed registry authentication contains invalid values");
  }
  const encoded = Buffer.from(JSON.stringify(auth), "utf8").toString("base64");
  if (Buffer.byteLength(encoded, "ascii") > MAX_REGISTRY_AUTH_BYTES) {
    throw new Error("Typed registry authentication exceeds its size limit");
  }
  return encoded;
}

type BrokerResponse = {
  statusCode: number;
  body: string;
};

type BrokerTransport = typeof http | typeof https;

type DockerSelfUpdateBrokerPort = {
  applySelfUpdate(input: DockerSelfUpdateInput): Promise<{
    updatedCount: number;
  }>;
};

export type DockerInspectionBrokerPort = DockerInventoryReaderPort &
  DockerContainerControllerPort &
  DockerResourceControllerPort &
  DockerPrunePort;

export type DockerResourceFileBrokerPort = ContainerFileSystemPort;

export type DockerResourceCommandBrokerPort = {
  ensureUpstandNetwork?(): Promise<{ id: string; created: boolean }>;
  buildResourceDockerfile?(
    target: DockerInspectionTarget,
    resourceId: string,
    imageName: string,
    contextPath: string,
    dockerfilePath: string,
    options?: {
      noCache?: boolean;
      target?: string;
      buildArgs?: Record<string, string>;
      preserveForRollback?: boolean;
      onLog?: (chunk: string) => void;
    },
  ): Promise<void>;
  pullResourceImage?(
    target: DockerInspectionTarget,
    resourceId: string,
    imageName: string,
    registryAuth?: {
      username: string;
      password: string;
      serveraddress?: string;
    },
  ): Promise<void>;
  markResourceImageForRollback?(
    target: DockerInspectionTarget,
    resourceId: string,
    imageName: string,
  ): Promise<void>;
  pushResourceImage?(
    target: DockerInspectionTarget,
    resourceId: string,
    imageName: string,
    registryAuth: {
      username: string;
      password: string;
      serveraddress?: string;
    },
  ): Promise<void>;
  upsertResourceService?(
    target: DockerInspectionTarget,
    resourceId: string,
    serviceName: string,
    spec: Record<string, unknown>,
    options?: {
      registryAuth?: {
        username: string;
        password: string;
        serveraddress?: string;
      };
    },
  ): Promise<void>;
  removeResourceService?(
    target: DockerInspectionTarget,
    resourceId: string,
    serviceName: string,
  ): Promise<void>;
  promoteResourceServiceRevision?(
    target: DockerInspectionTarget,
    resourceId: string,
    serviceName: string,
    revisionServiceName: string,
  ): Promise<void>;
  scaleResourceService?(
    target: DockerInspectionTarget,
    resourceId: string,
    serviceName: string,
    replicas: number,
  ): Promise<void>;
  ensureResourceNetwork?(
    target: DockerInspectionTarget,
    resourceId: string,
    options?: {
      networkKey?: string;
      projectName?: string;
      composeType?: "compose" | "stack";
      internal?: boolean;
    },
  ): Promise<{ id: string; name: string; created: boolean }>;
  ensureResourceVolume?(
    target: DockerInspectionTarget,
    resourceId: string,
    volumeKey: string,
    projectName: string,
    composeType: "compose" | "stack",
  ): Promise<void>;
  removeResourceNetwork?(
    target: DockerInspectionTarget,
    resourceId: string,
    networkId: string,
  ): Promise<void>;
  removeResourceVolume?(
    target: DockerInspectionTarget,
    resourceId: string,
    volumeId: string,
  ): Promise<void>;
  removeResourceCompose?(
    target: DockerInspectionTarget,
    resourceId: string,
    projectName: string,
    composeType: "compose" | "stack",
    deleteVolumes?: boolean,
  ): Promise<void>;
  ensureResourceServiceNetwork?(
    target: DockerInspectionTarget,
    resourceId: string,
    serviceName: string,
    networkId: string,
  ): Promise<void>;
  execContainerCommand(
    target: DockerInspectionTarget,
    containerId: string | undefined,
    command: string,
    options?: {
      timeoutSeconds?: number;
      maxOutputBytes?: number;
      onLog?: (chunk: string) => void;
    },
    resourceId?: string,
  ): Promise<{ output: string; stderr?: string; exitCode?: number }>;
  execResourceServiceCommand(
    target: DockerInspectionTarget,
    serviceName: string,
    command: string,
    options?: {
      timeoutSeconds?: number;
      maxOutputBytes?: number;
      onLog?: (chunk: string) => void;
    },
    resourceId?: string,
  ): Promise<{ output: string; stderr?: string; exitCode?: number }>;
  inspectResourceConvergence(
    target: DockerInspectionTarget,
    resourceId: string,
    serviceName: string,
  ): Promise<{
    tasks: Array<{
      state: string;
      desiredState: string;
      error?: string;
      containerId?: string;
      health: string;
    }>;
  }>;
};

const swarmInfoSchema = z.object({
  localNodeState: z.string(),
  controlAvailable: z.boolean(),
  nodeId: z.string(),
  nodeAddress: z.string(),
  nodeCount: z.number().int().nonnegative(),
});
const swarmInspectionSchema = z.object({
  id: z.string(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  dataPathPort: z.number().int().positive().optional(),
  defaultAddressPools: z.array(z.string()),
  workerJoinToken: z.string().optional(),
  managerJoinToken: z.string().optional(),
});
const swarmNodeSchema = z.object({
  id: z.string(),
  hostname: z.string(),
  role: z.string(),
  labels: z.record(z.string(), z.string()),
  availability: z.string(),
  status: z.string(),
  ip: z.string(),
  engineVersion: z.string(),
  version: z.number().int().nonnegative(),
  leader: z.boolean(),
  managerAddr: z.string(),
  reachability: z.string(),
  isLocalNode: z.boolean(),
});
const swarmServiceSchema = z.object({ id: z.string(), name: z.string() });
const swarmTaskSchema = z.object({
  id: z.string(),
  serviceId: z.string().optional(),
  nodeId: z.string().optional(),
  slot: z.number().int(),
  desiredState: z.string(),
  currentState: z.string(),
  message: z.string(),
  updatedAt: z.string().optional(),
  image: z.string(),
});
const swarmSuccessSchema = z.object({ success: z.literal(true) });
const inventoryInfoSchema = z.object({
  name: z.string(),
  serverVersion: z.string(),
  operatingSystem: z.string(),
  architecture: z.string(),
  containers: z.number().int().nonnegative(),
  images: z.number().int().nonnegative(),
  memoryBytes: z.number().int().nonnegative(),
  swarmState: z.string(),
});
const inventoryHostTimeSchema = z.object({
  epochSeconds: z.number().int(),
  iso: z.string(),
});
const inventoryContainerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  state: z.string(),
  status: z.string(),
  ports: z.string(),
  mounts: z.array(z.string()),
  networks: z.array(z.string()),
  labels: z.array(z.string()),
  createdAt: z.string().nullable(),
});
const inventoryImageSchema = z.object({
  id: z.string(),
  tags: z.array(z.string()),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string().nullable(),
});
const inventoryVolumeSchema = z.object({
  name: z.string(),
  driver: z.string(),
  mountpoint: z.string(),
});
const inventoryNetworkSchema = z.object({
  id: z.string(),
  name: z.string(),
  driver: z.string(),
  scope: z.string(),
  internal: z.boolean(),
  attachable: z.boolean(),
});
const inventoryServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.string(),
  replicas: z.string(),
  image: z.string(),
  ports: z.string(),
});
const inventorySwarmNodeSchema = z.object({
  id: z.string(),
  hostname: z.string(),
  ip: z.string(),
  isLeader: z.boolean(),
  status: z.string().optional(),
  serverType: z.string().optional(),
  role: z.string().optional(),
  isLocalNode: z.boolean().optional(),
});
const inventoryStatsSchema = z.object({
  containerId: z.string(),
  cpuPercent: z.number(),
  memoryUsageBytes: z.number().int().nonnegative(),
  memoryLimitBytes: z.number().int().nonnegative(),
  memoryPercent: z.number().nonnegative(),
  networkRxBytes: z.number().int().nonnegative(),
  networkTxBytes: z.number().int().nonnegative(),
  blockReadBytes: z.number().int().nonnegative(),
  blockWriteBytes: z.number().int().nonnegative(),
  pids: z.number().int().nonnegative(),
});
const inventoryLogsSchema = z.object({ logs: z.string() });
const inventoryPruneSchema = z.object({
  success: z.literal(true),
  output: z.array(z.string()),
});
const resourceFileMountSchema = z.object({
  name: z.string(),
  mountPath: z.string(),
  readOnly: z.boolean(),
});
const resourceFileContentSchema = z.object({ content: z.string() });
const resourceFileOutputSchema = z.object({ output: z.string() });
const resourceFileSuccessSchema = z.object({ success: z.literal(true) });
const resourceCommandResponseSchema = z.object({
  output: z.string().max(8 * 1024 * 1024),
  stderr: z.string().optional(),
  exitCode: z.number().int(),
});
const resourceConvergenceResponseSchema = z.object({
  tasks: z.array(
    z.object({
      state: z.string(),
      desiredState: z.string(),
      error: z.string().optional(),
      containerId: z.string().optional(),
      health: z.string(),
    }),
  ),
});
const resourceServiceSpecSchema = z.record(z.string(), z.unknown());
const MAX_RESOURCE_SERVICE_SPEC_BYTES = 512 * 1024;

function parseResourceFileListing(
  output: string,
  filePath: string,
  searchResult: boolean,
): ContainerFileItem[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [type, rawSize, rawMode, rawUpdated, encodedPath] = line.split("|");
      if (!encodedPath) return [];
      const decodedPath = Buffer.from(encodedPath, "base64").toString("utf8");
      const name = decodedPath.split("/").pop() || decodedPath;
      const path = searchResult
        ? decodedPath
        : `${filePath === "/" ? "" : filePath}/${name}`.replace(
            /^\/(.*)\/$/,
            "/$1",
          );
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

function brokerConfiguration(allowedCallers: readonly string[] = ["server"]):
  | {
      transport: BrokerTransport;
      hostname: string;
      port: number;
      tls:
        | {
            ca: Buffer;
            cert: Buffer;
            key: Buffer;
          }
        | undefined;
      token: string;
      caller: string;
    }
  | undefined {
  const configuredHost = process.env.DOCKER_HOST?.trim();
  const caller = process.env.UPSTAND_DOCKER_BROKER_CALLER?.trim();
  if (!configuredHost || !caller || !allowedCallers.includes(caller)) {
    return undefined;
  }

  const url = new URL(configuredHost);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.hostname !== "docker-broker"
  ) {
    return undefined;
  }

  const token = readDockerBrokerToken();
  if (!token) {
    throw new Error(
      "Docker broker token is required for typed broker operations",
    );
  }

  return {
    transport: url.protocol === "https:" ? https : http,
    hostname: url.hostname,
    port: Number(url.port || 2375),
    tls:
      url.protocol === "https:"
        ? {
            ca: readDockerBrokerTLSFile("UPSTAND_DOCKER_BROKER_CA_FILE", "CA"),
            cert: readDockerBrokerTLSFile(
              "UPSTAND_DOCKER_BROKER_CLIENT_CERT_FILE",
              "client certificate",
            ),
            key: readDockerBrokerTLSFile(
              "UPSTAND_DOCKER_BROKER_CLIENT_KEY_FILE",
              "client key",
            ),
          }
        : undefined,
    token,
    caller,
  };
}

function requestBroker(
  configuration: NonNullable<ReturnType<typeof brokerConfiguration>>,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<BrokerResponse> {
  return new Promise((resolve, reject) => {
    const serializedBody =
      body === undefined ? undefined : JSON.stringify(body);
    const scopeHeaders = readDeploymentScopeHeaders();
    const request = configuration.transport.request(
      {
        hostname: configuration.hostname,
        port: configuration.port,
        path,
        method,
        headers: {
          Accept: "application/json",
          ...(extraHeaders ?? {}),
          ...scopeHeaders,
          "X-Upstand-Docker-Broker-Token": configuration.token,
          "X-Upstand-Docker-Caller": configuration.caller,
          ...(serializedBody
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(serializedBody),
              }
            : {}),
        },
        ...(configuration.tls ?? {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        response.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes <= MAX_RESPONSE_BYTES) chunks.push(chunk);
        });
        response.once("end", () => {
          if (totalBytes > MAX_RESPONSE_BYTES) {
            reject(
              new Error("Docker typed broker response exceeded its limit"),
            );
            return;
          }
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("Docker typed broker request timed out"));
    });
    request.once("error", reject);
    if (serializedBody) request.write(serializedBody);
    request.end();
  });
}

function createBoundedDockerBuildContext(
  contextPath: string,
  dockerfilePath: string,
): Readable {
  const dockerfileRelative = path
    .relative(contextPath, dockerfilePath)
    .split(path.sep)
    .join("/");
  if (
    !dockerfileRelative ||
    dockerfileRelative.startsWith("../") ||
    dockerfileRelative === ".." ||
    dockerfileRelative.startsWith("/") ||
    dockerfileRelative.includes("\\") ||
    dockerfileRelative
      .split("/")
      .some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      "The Dockerfile must be located inside the Docker build context",
    );
  }

  const ignore = dockerIgnore();
  const ignorePath = path.join(contextPath, ".dockerignore");
  if (fs.existsSync(ignorePath)) {
    ignore.add(fs.readFileSync(ignorePath, "utf8"));
  }
  const source = tarFs.pack(contextPath, {
    ignore: (absolutePath) => {
      const relative = path
        .relative(contextPath, absolutePath)
        .split(path.sep)
        .join("/");
      return (
        relative !== dockerfileRelative &&
        relative !== "" &&
        ignore.ignores(relative)
      );
    },
  });
  let totalBytes = 0;
  const bounded = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_BUILD_CONTEXT_BYTES) {
        callback(new Error("Docker build context exceeds its size limit"));
        return;
      }
      callback(null, chunk);
    },
  });
  source.once("error", (error) => bounded.destroy(error));
  source.pipe(bounded);
  return bounded;
}

function requestBrokerStream(
  configuration: NonNullable<ReturnType<typeof brokerConfiguration>>,
  pathName: string,
  body: Readable,
  headers: Record<string, string>,
  onChunk?: (chunk: Buffer) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const scopeHeaders = readDeploymentScopeHeaders();
    const request = configuration.transport.request(
      {
        hostname: configuration.hostname,
        port: configuration.port,
        path: pathName,
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-tar",
          "X-Upstand-Docker-Broker-Token": configuration.token,
          "X-Upstand-Docker-Caller": configuration.caller,
          ...headers,
          ...scopeHeaders,
        },
        ...(configuration.tls ?? {}),
      },
      (response) => {
        const successful =
          (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300;
        let totalBytes = 0;
        response.on("data", (chunk: Buffer) => {
          totalBytes += chunk.byteLength;
          if (totalBytes > MAX_BUILD_RESPONSE_BYTES) {
            response.destroy(
              new Error("Docker typed build response exceeded its limit"),
            );
            return;
          }
          if (successful) onChunk?.(chunk);
        });
        response.once("end", () => {
          if (!successful) {
            finish(
              new Error(
                `Docker typed broker request failed with HTTP ${response.statusCode ?? 0}`,
              ),
            );
            return;
          }
          finish();
        });
        response.once("error", (error) => finish(error));
      },
    );
    request.setTimeout(BUILD_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("Docker typed build request timed out"));
    });
    request.once("error", (error) => finish(error));
    body.once("error", (error) => request.destroy(error));
    body.pipe(request);
  });
}

async function callBroker(
  configuration: NonNullable<ReturnType<typeof brokerConfiguration>>,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const parsed = await callBrokerValue(configuration, method, path, body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Docker typed broker returned an invalid response");
  }
  return parsed as Record<string, unknown>;
}

async function callBrokerValue(
  configuration: NonNullable<ReturnType<typeof brokerConfiguration>>,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  const response = await requestBroker(
    configuration,
    method,
    path,
    body,
    extraHeaders,
  );
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Docker typed broker request failed with HTTP ${response.statusCode}`,
    );
  }
  if (!response.body) return {};
  return JSON.parse(response.body) as unknown;
}

export function createDockerWebServerBrokerClient():
  | DockerWebServerMaintenancePort
  | undefined {
  const configuration = brokerConfiguration();
  if (!configuration) return undefined;

  return {
    async forceServiceUpdate(serviceName) {
      await callBroker(
        configuration,
        "POST",
        "/upstand/v1/web-server/service-update",
        { service_name: serviceName },
      );
    },

    async getServiceLogs(serviceName, tail) {
      const response = await callBroker(
        configuration,
        "POST",
        "/upstand/v1/web-server/service-logs",
        { service_name: serviceName, tail },
      );
      if (typeof response.logs !== "string") {
        throw new Error("Docker typed broker returned no service logs");
      }
      return response.logs;
    },

    async execServiceCommand(serviceName, command) {
      await callBroker(
        configuration,
        "POST",
        "/upstand/v1/web-server/service-command",
        { service_name: serviceName, command },
      );
    },

    async inspectNetwork(networkName) {
      const response = await callBroker(
        configuration,
        "GET",
        "/upstand/v1/web-server/network?name=" +
          encodeURIComponent(networkName),
      );
      if (
        typeof response.driver !== "string" ||
        typeof response.attachable !== "boolean"
      ) {
        throw new Error(
          "Docker typed broker returned an invalid network response",
        );
      }
      return {
        driver: response.driver,
        attachable: response.attachable,
      };
    },
  };
}

export function createDockerCaddyBrokerClient():
  | CaddyProvisioningPort
  | undefined {
  const configuration = brokerConfiguration();
  if (!configuration) return undefined;

  return {
    async ensureCaddyContainer(input: CaddyProvisioningInput) {
      await callBroker(configuration, "POST", "/upstand/v1/web-server/caddy", {
        operation: "ensure",
        network_name: input.networkName,
        caddyfile_base64: input.caddyfileBase64,
        environment: input.environment,
        ports: input.ports.map((port) => ({
          protocol: port.protocol,
          target_port: port.targetPort,
          published_port: port.publishedPort,
        })),
        ...(input.forceRecreate ? { force_recreate: true } : {}),
      });
    },
    async applyCaddyConfiguration(input: CaddyConfigurationInput) {
      const response = await callBroker(
        configuration,
        "POST",
        "/upstand/v1/web-server/caddy/configure",
        {
          operation: "apply_configuration",
          caddyfile_base64: input.caddyfileBase64,
          certificates: input.certificates,
        },
      );
      if (typeof response.changed !== "boolean") {
        throw new Error("Docker typed broker returned no Caddy change status");
      }
      return { changed: response.changed };
    },
  };
}

export function createDockerCleanupBrokerClient():
  | DockerCleanupPort
  | undefined {
  const configuration = brokerConfiguration();
  if (!configuration) return undefined;

  return {
    async cleanupDocker(command, options) {
      await callBroker(configuration, "POST", "/upstand/v1/server/cleanup", {
        command,
        ...(options.preserveRollbackImages === undefined
          ? {}
          : { preserve_rollback_images: options.preserveRollbackImages }),
        ...(options.pruneNetworks === undefined
          ? {}
          : { prune_networks: options.pruneNetworks }),
      });
    },
  };
}

export function createDockerSelfUpdateBrokerClient():
  | DockerSelfUpdateBrokerPort
  | undefined {
  const configuration = brokerConfiguration();
  if (!configuration) return undefined;

  return {
    async applySelfUpdate(input) {
      const response = await callBroker(
        configuration,
        "POST",
        "/upstand/v1/server/self-update",
        input,
      );
      if (
        typeof response.updated_count !== "number" ||
        !Number.isInteger(response.updated_count) ||
        response.updated_count < 0
      ) {
        throw new Error("Docker typed broker returned an invalid update count");
      }
      return { updatedCount: response.updated_count };
    },
  };
}

export function createDockerSwarmBrokerClient():
  | DockerSwarmManagementPort
  | undefined {
  const configuration = brokerConfiguration();
  if (!configuration) return undefined;

  const request = (operation: string, input: Record<string, unknown> = {}) =>
    callBrokerValue(configuration, "POST", "/upstand/v1/server/swarm", {
      operation,
      ...input,
    });

  return {
    async getInfo(): Promise<DockerSwarmInfoPort> {
      return swarmInfoSchema.parse(await request("info"));
    },

    async inspectSwarm(): Promise<DockerSwarmInspectionPort> {
      const value = swarmInspectionSchema.parse(await request("inspect"));
      return {
        ...value,
        createdAt: value.createdAt ?? null,
        updatedAt: value.updatedAt ?? null,
        dataPathPort: value.dataPathPort ?? null,
      };
    },

    async listNodes(): Promise<DockerSwarmNodePort[]> {
      return z.array(swarmNodeSchema).parse(await request("list_nodes"));
    },

    async listServices(): Promise<DockerSwarmServicePort[]> {
      return z.array(swarmServiceSchema).parse(await request("list_services"));
    },

    async listTasks(): Promise<DockerSwarmTaskPort[]> {
      const values = z
        .array(swarmTaskSchema)
        .parse(await request("list_tasks"));
      return values.map((value) => ({
        ...value,
        updatedAt: value.updatedAt ?? null,
      }));
    },

    async initialize(input) {
      swarmSuccessSchema.parse(
        await request("initialize", {
          advertise_addr: input.advertiseAddr,
          ...(input.dataPathAddr ? { data_path_addr: input.dataPathAddr } : {}),
          default_addr_pools: input.defaultAddrPools,
          subnet_size: input.subnetSize,
        }),
      );
    },

    async updateSwarm(input) {
      swarmSuccessSchema.parse(
        await request("update", {
          version: input.version,
          ...(input.taskHistoryRetentionLimit === undefined
            ? {}
            : {
                task_history_retention_limit: input.taskHistoryRetentionLimit,
              }),
          ...(input.rotateWorkerToken ? { rotate_worker_token: true } : {}),
          ...(input.rotateManagerToken ? { rotate_manager_token: true } : {}),
        }),
      );
    },

    async inspectNode(nodeId) {
      return swarmNodeSchema.parse(
        await request("inspect_node", { node_id: nodeId }),
      );
    },

    async updateNode(nodeId, input) {
      swarmSuccessSchema.parse(
        await request("update_node", {
          node_id: nodeId,
          version: input.version,
          name: input.name,
          labels: input.labels,
          role: input.role,
          availability: input.availability,
        }),
      );
    },

    async removeNode(nodeId, force) {
      swarmSuccessSchema.parse(
        await request("remove_node", { node_id: nodeId, force }),
      );
    },

    async ensureUpstandNetwork() {
      const value = z.object({ id: z.string(), created: z.boolean() }).parse(
        await request("ensure_network", {
          network_name: process.env.DOCKER_NETWORK?.trim() || "upstand-network",
        }),
      );
      return value;
    },
  };
}

export function createDockerInspectionBrokerClient():
  | DockerInspectionBrokerPort
  | undefined {
  const configuration = brokerConfiguration();
  if (!configuration) return undefined;

  const request = (operation: string, input: Record<string, unknown> = {}) =>
    callBrokerValue(configuration, "POST", "/upstand/v1/server/inventory", {
      operation,
      ...input,
    });
  const requireLocalTarget = (target: DockerInspectionTarget) => {
    if (target.kind !== "local") {
      throw new Error(
        "The typed Docker broker only handles the local control-plane target",
      );
    }
  };

  return {
    async getInfo(target: DockerInspectionTarget): Promise<DockerInfo> {
      requireLocalTarget(target);
      return inventoryInfoSchema.parse(await request("info"));
    },

    async getHostTime(
      target: DockerInspectionTarget,
    ): Promise<{ epochSeconds: number; iso: string }> {
      requireLocalTarget(target);
      return inventoryHostTimeSchema.parse(await request("host_time"));
    },

    async listContainers(
      target: DockerInspectionTarget,
      options?: { search?: string; state?: string },
    ): Promise<DockerContainer[]> {
      requireLocalTarget(target);
      return z.array(inventoryContainerSchema).parse(
        await request("containers", {
          ...(options?.search ? { search: options.search } : {}),
          ...(options?.state ? { state: options.state } : {}),
        }),
      );
    },

    async listImages(target: DockerInspectionTarget): Promise<DockerImage[]> {
      requireLocalTarget(target);
      return z.array(inventoryImageSchema).parse(await request("images"));
    },

    async listVolumes(target: DockerInspectionTarget): Promise<DockerVolume[]> {
      requireLocalTarget(target);
      return z.array(inventoryVolumeSchema).parse(await request("volumes"));
    },

    async listNetworks(
      target: DockerInspectionTarget,
    ): Promise<DockerNetwork[]> {
      requireLocalTarget(target);
      return z.array(inventoryNetworkSchema).parse(await request("networks"));
    },

    async listServices(
      target: DockerInspectionTarget,
    ): Promise<DockerServiceSummary[]> {
      requireLocalTarget(target);
      return z.array(inventoryServiceSchema).parse(await request("services"));
    },

    async listSwarmNodes(target: DockerInspectionTarget) {
      requireLocalTarget(target);
      return z
        .array(inventorySwarmNodeSchema)
        .parse(await request("swarm_nodes"));
    },

    async getLogs(
      target: DockerInspectionTarget,
      input: DockerLogRequest,
    ): Promise<string> {
      requireLocalTarget(target);
      const response = inventoryLogsSchema.parse(
        await request("logs", {
          ...(input.containerId ? { container_id: input.containerId } : {}),
          ...(input.serviceName ? { service_name: input.serviceName } : {}),
          tail: input.tail,
          ...(input.since === undefined ? {} : { since: input.since }),
          ...(input.search ? { search_logs: input.search } : {}),
          ...(input.levels ? { log_levels: input.levels } : {}),
        }),
      );
      return filterDockerLogs(cleanDockerLogs(response.logs), input);
    },

    async getContainerStats(
      target: DockerInspectionTarget,
      containerId: string,
    ): Promise<DockerContainerStats> {
      requireLocalTarget(target);
      return inventoryStatsSchema.parse(
        await request("stats", { container_id: containerId }),
      );
    },

    async controlContainer(
      target: DockerInspectionTarget,
      containerId: string,
      command: DockerContainerCommand,
    ): Promise<{ success: true }> {
      requireLocalTarget(target);
      return z.object({ success: z.literal(true) }).parse(
        await request("control_container", {
          container_id: containerId,
          command,
        }),
      );
    },

    async controlResource(
      target: DockerInspectionTarget,
      resourceId: string,
      command: DockerResourceCommand,
    ): Promise<{ success: true }> {
      requireLocalTarget(target);
      return z.object({ success: z.literal(true) }).parse(
        await request("control_resource", {
          resource_id: resourceId,
          command,
        }),
      );
    },

    async prune(
      target: DockerInspectionTarget,
      type: DockerPruneType,
      options: DockerPruneOptions = {},
    ): Promise<{ success: true; output: string[] }> {
      requireLocalTarget(target);
      return inventoryPruneSchema.parse(
        await request("prune", {
          type,
          ...(options.preserveRollbackImages === undefined
            ? {}
            : { preserve_rollback_images: options.preserveRollbackImages }),
          ...(options.pruneNetworks === undefined
            ? {}
            : { prune_networks: options.pruneNetworks }),
        }),
      );
    },
  };
}

export function createDockerResourceFileBrokerClient():
  | DockerResourceFileBrokerPort
  | undefined {
  const configuration = brokerConfiguration();
  if (!configuration) return undefined;

  const request = (
    operation: string,
    resourceId: string,
    containerId: string,
    input: Record<string, unknown> = {},
  ) =>
    callBrokerValue(
      configuration,
      "POST",
      "/upstand/v1/server/resource-files",
      {
        operation,
        resource_id: resourceId,
        container_id: containerId,
        ...input,
      },
    );
  const requireLocalTarget = (target: DockerInspectionTarget) => {
    if (target.kind !== "local") {
      throw new Error(
        "The typed Docker broker only handles the local control-plane target",
      );
    }
  };
  const success = async (value: Promise<unknown>) => {
    resourceFileSuccessSchema.parse(await value);
  };

  return {
    async getContainerMounts(
      target: DockerInspectionTarget,
      containerId: string,
      resourceId: string,
    ): Promise<ContainerVolumeMount[]> {
      requireLocalTarget(target);
      const mounts = z
        .array(resourceFileMountSchema)
        .parse(await request("mounts", resourceId, containerId));
      return mounts.map((mount) => ({
        type: "volume" as const,
        name: mount.name,
        destination: mount.mountPath,
        readOnly: mount.readOnly,
      }));
    },

    async listFiles(
      target: DockerInspectionTarget,
      containerId: string,
      mountPath: string,
      filePath: string,
      resourceId: string,
    ): Promise<ContainerFileItem[]> {
      requireLocalTarget(target);
      const response = resourceFileOutputSchema.parse(
        await request("list", resourceId, containerId, {
          mount_path: mountPath,
          path: filePath,
        }),
      );
      return parseResourceFileListing(response.output, filePath, false);
    },

    async readFile(
      target: DockerInspectionTarget,
      containerId: string,
      mountPath: string,
      filePath: string,
      _encoding: "text" | "base64",
      resourceId: string,
    ): Promise<{ content: string }> {
      requireLocalTarget(target);
      return resourceFileContentSchema.parse(
        await request("read", resourceId, containerId, {
          mount_path: mountPath,
          path: filePath,
        }),
      );
    },

    async writeFile(
      target: DockerInspectionTarget,
      containerId: string,
      mountPath: string,
      filePath: string,
      contentBase64: string,
      resourceId: string,
    ): Promise<void> {
      requireLocalTarget(target);
      await success(
        request("write", resourceId, containerId, {
          mount_path: mountPath,
          path: filePath,
          content_base64: contentBase64,
        }),
      );
    },

    async createItem(
      target: DockerInspectionTarget,
      containerId: string,
      mountPath: string,
      filePath: string,
      type: "file" | "directory",
      resourceId: string,
    ): Promise<void> {
      requireLocalTarget(target);
      await success(
        request("create", resourceId, containerId, {
          mount_path: mountPath,
          path: filePath,
          type,
        }),
      );
    },

    async renameItem(
      target: DockerInspectionTarget,
      containerId: string,
      mountPath: string,
      oldPath: string,
      newPath: string,
      resourceId: string,
    ): Promise<void> {
      requireLocalTarget(target);
      await success(
        request("rename", resourceId, containerId, {
          mount_path: mountPath,
          old_path: oldPath,
          new_path: newPath,
        }),
      );
    },

    async deleteItem(
      target: DockerInspectionTarget,
      containerId: string,
      mountPath: string,
      filePath: string,
      resourceId: string,
    ): Promise<void> {
      requireLocalTarget(target);
      await success(
        request("delete", resourceId, containerId, {
          mount_path: mountPath,
          path: filePath,
        }),
      );
    },

    async changePermissions(
      target: DockerInspectionTarget,
      containerId: string,
      mountPath: string,
      filePath: string,
      mode: string,
      resourceId: string,
    ): Promise<void> {
      requireLocalTarget(target);
      await success(
        request("chmod", resourceId, containerId, {
          mount_path: mountPath,
          path: filePath,
          mode,
        }),
      );
    },

    async searchFiles(
      target: DockerInspectionTarget,
      containerId: string,
      mountPath: string,
      filePath: string,
      query: string,
      resourceId: string,
    ): Promise<ContainerFileItem[]> {
      requireLocalTarget(target);
      const response = resourceFileOutputSchema.parse(
        await request("search", resourceId, containerId, {
          mount_path: mountPath,
          path: filePath,
          query,
        }),
      );
      return parseResourceFileListing(response.output, filePath, true);
    },
  };
}

function hasTypedBuildArgumentControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint === 0x7f) return true;
  }
  return false;
}

export function createDockerResourceCommandBrokerClient():
  | DockerResourceCommandBrokerPort
  | undefined {
  const configuration = brokerConfiguration([
    "server",
    "schedules",
    "deployment-worker",
  ]);
  if (!configuration) return undefined;

  const run = async (
    target: DockerInspectionTarget,
    input: Record<string, unknown>,
    options?: {
      onLog?: (chunk: string) => void;
      maxOutputBytes?: number;
    },
  ) => {
    if (target.kind !== "local") {
      throw new Error(
        "The typed Docker broker only handles the local control-plane target",
      );
    }
    const response = resourceCommandResponseSchema.parse(
      await callBrokerValue(
        configuration,
        "POST",
        "/upstand/v1/server/resource-command",
        input,
      ),
    );
    if (options?.onLog && response.output) options.onLog(response.output);
    return response;
  };

  return {
    async buildResourceDockerfile(
      target,
      resourceId,
      imageName,
      contextPath,
      dockerfilePath,
      options,
    ) {
      if (target.kind !== "local") {
        throw new Error(
          "The typed Docker broker only handles the local control-plane target",
        );
      }
      if (!resourceId || !imageName) {
        throw new Error(
          "A resource ID and image name are required for typed Docker builds",
        );
      }
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,510}:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(
          imageName,
        )
      ) {
        throw new Error("The typed Docker build image name is invalid");
      }
      if (
        !fs.statSync(contextPath).isDirectory() ||
        !fs.statSync(dockerfilePath).isFile()
      ) {
        throw new Error("The Docker build context and Dockerfile must exist");
      }
      if (
        options?.target &&
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(options.target)
      ) {
        throw new Error("The typed Docker build target is invalid");
      }
      const buildArgs = options?.buildArgs ?? {};
      if (Object.keys(buildArgs).length > 64) {
        throw new Error("The typed Docker build has too many build arguments");
      }
      for (const [key, value] of Object.entries(buildArgs)) {
        if (
          !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) ||
          value.length > 8192 ||
          hasTypedBuildArgumentControlCharacter(value)
        ) {
          throw new Error("The typed Docker build argument is invalid");
        }
      }
      const context = createBoundedDockerBuildContext(
        contextPath,
        dockerfilePath,
      );
      await requestBrokerStream(
        configuration,
        "/upstand/v1/server/resource-build",
        context,
        {
          "X-Upstand-Resource-ID": resourceId,
          "X-Upstand-Image": imageName,
          "X-Upstand-Dockerfile": path
            .relative(contextPath, dockerfilePath)
            .split(path.sep)
            .join("/"),
          "X-Upstand-Docker-No-Cache": String(options?.noCache === true),
          ...(Object.keys(buildArgs).length > 0
            ? {
                "X-Upstand-Build-Args": Buffer.from(
                  JSON.stringify(buildArgs),
                ).toString("base64url"),
              }
            : {}),
          ...(options?.target
            ? { "X-Upstand-Build-Target": options.target }
            : {}),
          "X-Upstand-Rollback": String(options?.preserveForRollback === true),
        },
        (chunk) => options?.onLog?.(chunk.toString("utf8")),
      );
    },

    async pushResourceImage(target, resourceId, imageName, registryAuth) {
      if (target.kind !== "local") {
        throw new Error(
          "The typed Docker broker only handles the local control-plane target",
        );
      }
      if (!resourceId || !imageName) {
        throw new Error(
          "A resource ID and image name are required for typed image pushes",
        );
      }
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,510}:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(
          imageName,
        )
      ) {
        throw new Error("The typed Docker push image name is invalid");
      }
      await callBrokerValue(
        configuration,
        "POST",
        "/upstand/v1/server/resource-push",
        { resource_id: resourceId, image: imageName },
        {
          "X-Upstand-Registry-Auth": encodeTypedRegistryAuth(registryAuth),
        },
      );
    },

    async pullResourceImage(target, resourceId, imageName, registryAuth) {
      if (target.kind !== "local") {
        throw new Error(
          "The typed Docker broker only handles the local control-plane target",
        );
      }
      if (!resourceId || !imageName) {
        throw new Error(
          "A resource ID and image name are required for typed image pulls",
        );
      }
      if (!TYPED_RESOURCE_IMAGE_REFERENCE_PATTERN.test(imageName)) {
        throw new Error("The typed Docker pull image name is invalid");
      }
      await callBrokerValue(
        configuration,
        "POST",
        "/upstand/v1/server/resource-pull",
        { resource_id: resourceId, image: imageName },
        registryAuth
          ? {
              "X-Upstand-Registry-Auth": encodeTypedRegistryAuth(registryAuth),
            }
          : undefined,
      );
    },

    async markResourceImageForRollback(target, resourceId, imageName) {
      if (target.kind !== "local") {
        throw new Error(
          "The typed Docker broker only handles the local control-plane target",
        );
      }
      if (!resourceId || !imageName) {
        throw new Error(
          "A resource ID and image name are required for typed rollback markers",
        );
      }
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,510}:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(
          imageName,
        )
      ) {
        throw new Error("The typed rollback marker image name is invalid");
      }
      await callBrokerValue(
        configuration,
        "POST",
        "/upstand/v1/server/resource-rollback",
        { resource_id: resourceId, image: imageName },
      );
    },

    async upsertResourceService(
      target,
      resourceId,
      serviceName,
      spec,
      options,
    ) {
      if (target.kind !== "local") {
        throw new Error(
          "The typed Docker broker only handles the local control-plane target",
        );
      }
      if (!resourceId || !serviceName) {
        throw new Error(
          "A resource ID and service name are required for typed service mutation",
        );
      }
      const boundedSpec = resourceServiceSpecSchema.parse(spec);
      const encodedSpec = JSON.stringify(boundedSpec);
      if (
        Buffer.byteLength(encodedSpec, "utf8") > MAX_RESOURCE_SERVICE_SPEC_BYTES
      ) {
        throw new Error(
          "The typed resource service spec exceeds its size limit",
        );
      }
      await callBrokerValue(
        configuration,
        "POST",
        "/upstand/v1/server/resource-service",
        {
          operation: "upsert",
          resource_id: resourceId,
          service_name: serviceName,
          spec: boundedSpec,
        },
        options?.registryAuth
          ? {
              "X-Upstand-Registry-Auth": encodeTypedRegistryAuth(
                options.registryAuth,
              ),
            }
          : undefined,
      );
    },

    async removeResourceService(target, resourceId, serviceName) {
      if (target.kind !== "local") {
        throw new Error(
          "The typed Docker broker only handles the local control-plane target",
        );
      }
      if (!resourceId || !serviceName) {
        throw new Error(
          "A resource ID and service name are required for typed service removal",
        );
      }
      await callBrokerValue(
        configuration,
        "POST",
        "/upstand/v1/server/resource-service",
        {
          operation: "remove",
          resource_id: resourceId,
          service_name: serviceName,
        },
      );
    },

    async promoteResourceServiceRevision(
      target,
      resourceId,
      serviceName,
      revisionServiceName,
    ) {
      if (target.kind !== "local") {
        throw new Error(
          "The typed Docker broker only handles the local control-plane target",
        );
      }
      if (!resourceId || !serviceName || !revisionServiceName) {
        throw new Error(
          "A resource ID, base service name, and revision service name are required",
        );
      }
      await callBrokerValue(
        configuration,
        "POST",
        "/upstand/v1/server/resource-service",
        {
          operation: "promote_revision",
          resource_id: resourceId,
          service_name: serviceName,
          revision_service_name: revisionServiceName,
        },
      );
    },

    async scaleResourceService(target, resourceId, serviceName, replicas) {
      if (target.kind !== "local") {
        throw new Error(
          "The typed Docker broker only handles the local control-plane target",
        );
      }
      if (
        !resourceId ||
        !serviceName ||
        !Number.isInteger(replicas) ||
        replicas < 0 ||
        replicas > 1000
      ) {
        throw new Error(
          "A resource ID, service name, and replica count between 0 and 1000 are required",
        );
      }
      await callBrokerValue(
        configuration,
        "POST",
        "/upstand/v1/server/resource-service",
        {
          operation: "scale",
          resource_id: resourceId,
          service_name: serviceName,
          replicas,
        },
      );
    },

    async ensureUpstandNetwork() {
      const value = z
        .object({ id: z.string().min(1), created: z.boolean() })
        .parse(
          await callBrokerValue(
            configuration,
            "POST",
            "/upstand/v1/server/swarm",
            {
              operation: "ensure_network",
              network_name:
                process.env.DOCKER_NETWORK?.trim() || "upstand-network",
            },
          ),
        );
      return value;
    },

    async ensureResourceNetwork(target, resourceId, options) {
      if (target.kind !== "local") {
        throw new Error(
          "The typed Docker broker only handles the local control-plane target",
        );
      }
      if (!resourceId) {
        throw new Error("A resource ID is required for typed network creation");
      }
      if (
        options?.networkKey !== undefined &&
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(options.networkKey)
      ) {
        throw new Error("The typed resource network key is invalid");
      }
      if (
        options?.projectName !== undefined &&
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(options.projectName)
      ) {
        throw new Error("The typed resource network project name is invalid");
      }
      const response = z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
          created: z.boolean(),
        })
        .parse(
          await callBrokerValue(
            configuration,
            "POST",
            "/upstand/v1/server/resource-network",
            {
              operation: "ensure",
              resource_id: resourceId,
              ...(options?.networkKey
                ? { network_key: options.networkKey }
                : {}),
              ...(options?.projectName
                ? { project_name: options.projectName }
                : {}),
              ...(options?.composeType
                ? { compose_type: options.composeType }
                : {}),
              ...(options?.internal ? { internal: true } : {}),
            },
          ),
        );
      return response;
    },

    async ensureResourceVolume(
      target,
      resourceId,
      volumeKey,
      projectName,
      composeType,
    ) {
      if (target.kind !== "local") {
        throw new Error(
          "The typed Docker broker only handles the local control-plane target",
        );
      }
      if (
        !resourceId ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(volumeKey) ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(projectName)
      ) {
        throw new Error("The typed resource volume identity is invalid");
      }
      await callBrokerValue(
        configuration,
        "POST",
        "/upstand/v1/server/resource-volume",
        {
          operation: "ensure",
          resource_id: resourceId,
          volume_key: volumeKey,
          project_name: projectName,
          compose_type: composeType,
        },
      );
    },

    async removeResourceNetwork(target, resourceId, networkId) {
      if (target.kind !== "local") {
        throw new Error(
          "The typed Docker broker only handles the local control-plane target",
        );
      }
      if (!resourceId || !networkId) {
        throw new Error(
          "A resource ID and network ID are required for typed network removal",
        );
      }
      await callBrokerValue(
        configuration,
        "POST",
        "/upstand/v1/server/resource-network",
        {
          operation: "remove",
          resource_id: resourceId,
          network_id: networkId,
        },
      );
    },

    async removeResourceVolume(target, resourceId, volumeId) {
      if (target.kind !== "local") {
        throw new Error(
          "The typed Docker broker only handles the local control-plane target",
        );
      }
      if (!resourceId || !volumeId) {
        throw new Error(
          "A resource ID and volume ID are required for typed volume removal",
        );
      }
      await callBrokerValue(
        configuration,
        "POST",
        "/upstand/v1/server/resource-volume",
        {
          operation: "remove",
          resource_id: resourceId,
          volume_id: volumeId,
        },
      );
    },

    async removeResourceCompose(
      target,
      resourceId,
      projectName,
      composeType,
      deleteVolumes = false,
    ) {
      if (target.kind !== "local") {
        throw new Error(
          "The typed Docker broker only handles the local control-plane target",
        );
      }
      if (!resourceId || !projectName) {
        throw new Error(
          "A resource ID and project name are required for typed Compose removal",
        );
      }
      await callBrokerValue(
        configuration,
        "POST",
        "/upstand/v1/server/resource-teardown",
        {
          operation: "remove",
          resource_id: resourceId,
          project_name: projectName,
          compose_type: composeType,
          delete_volumes: deleteVolumes,
        },
      );
    },

    async ensureResourceServiceNetwork(
      target,
      resourceId,
      serviceName,
      networkId,
    ) {
      if (target.kind !== "local") {
        throw new Error(
          "The typed Docker broker only handles the local control-plane target",
        );
      }
      if (!resourceId || !serviceName || !networkId) {
        throw new Error(
          "A resource, service, and network ID are required for typed network attachment",
        );
      }
      await callBrokerValue(
        configuration,
        "POST",
        "/upstand/v1/server/resource-service",
        {
          operation: "ensure_network",
          resource_id: resourceId,
          service_name: serviceName,
          network_id: networkId,
        },
      );
    },

    async execContainerCommand(
      target,
      containerId,
      command,
      options,
      resourceId,
    ) {
      if (!resourceId) {
        throw new Error(
          "A resource ID is required for typed container command execution",
        );
      }
      return run(
        target,
        {
          resource_id: resourceId,
          command,
          ...(containerId ? { container_id: containerId } : {}),
          ...(options?.timeoutSeconds === undefined
            ? {}
            : { timeout_seconds: options.timeoutSeconds }),
          ...(options?.maxOutputBytes === undefined
            ? {}
            : { max_output_bytes: options.maxOutputBytes }),
        },
        options,
      );
    },

    async execResourceServiceCommand(
      target,
      serviceName,
      command,
      options,
      resourceId,
    ) {
      if (!resourceId) {
        throw new Error(
          "A resource ID is required for typed container command execution",
        );
      }
      return run(
        target,
        {
          resource_id: resourceId,
          service_name: serviceName,
          command,
          ...(options?.timeoutSeconds === undefined
            ? {}
            : { timeout_seconds: options.timeoutSeconds }),
          ...(options?.maxOutputBytes === undefined
            ? {}
            : { max_output_bytes: options.maxOutputBytes }),
        },
        options,
      );
    },

    async inspectResourceConvergence(target, resourceId, serviceName) {
      if (!resourceId || !serviceName) {
        throw new Error(
          "A resource ID and service name are required for typed convergence inspection",
        );
      }
      if (target.kind !== "local") {
        throw new Error(
          "The typed Docker broker only handles the local control-plane target",
        );
      }
      return resourceConvergenceResponseSchema.parse(
        await callBrokerValue(
          configuration,
          "POST",
          "/upstand/v1/server/resource-convergence",
          { resource_id: resourceId, service_name: serviceName },
        ),
      );
    },
  };
}
