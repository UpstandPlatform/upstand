import type {
  ApplicationBuildConfig,
  Resource,
  ResourceAutoscalingProjection,
} from "@upstand/domain";
import type { DockerLogLevel } from "../resource/docker-log-filter";
import type { CaddyServicePort } from "./caddy";
import type { DockerSwarmManagementPort } from "./swarm";

export interface ContainerRuntimeStats {
  cpu: number;
  ram: number;
  ramUsage: number;
  ramLimit: number;
  networkRxBytes: number;
  networkTxBytes: number;
}

export interface ServerRuntimeStats {
  collectedAt: string;
  serverName: string;
  dockerVersion: string;
  operatingSystem: string;
  kernelVersion: string;
  architecture: string;
  cpu: number;
  cpuCores: number;
  memoryUsage: number;
  memoryTotal: number;
  memoryPercent: number;
  activeContainers: number;
  networkRxBytes: number;
  networkTxBytes: number;
  dockerImageBytes: number;
  dockerContainerBytes: number;
  dockerVolumeBytes: number;
  dockerBuildCacheBytes: number;
}

export interface DockerRegistryAuth {
  username?: string;
  password?: string;
  serveraddress?: string;
}

/**
 * Minimal Docker daemon capability shared with deployment workflows.
 *
 * The application layer passes this value between adapters without inspecting
 * it. The concrete Docker client remains an infrastructure concern.
 */
export type DockerApiTarget = unknown;

export interface DockerResourceContainer {
  id: string;
  name: string;
  status: string;
  ports: string;
  node: string;
}

export interface ConvergenceOptions {
  timeoutSeconds?: number;
  stabilityWindowSeconds?: number;
  destinationDocker?: DockerApiTarget;
  serviceNameOverride?: string;
  onLog?: (log: string) => void;
}

export interface DeploymentRevisionOptions {
  serviceNameOverride?: string;
  replicasOverride?: number;
  imageTagSuffix?: string;
}

export interface ResolvedBuildArtifact {
  buildConfig: ApplicationBuildConfig;
  detectorVersion: string | null;
  sourceRevision: string;
  configurationVersion: string;
  digest: string;
  reference: string;
}

export interface ConvergenceResult {
  healthy: boolean;
  state?: string;
  message?: string;
}

export interface DockerServicePort {
  listServices(): Promise<DockerSelfUpdateServiceSummary[]>;
  inspectService(serviceId: string): Promise<DockerSelfUpdateServiceInspection>;
  updateService(
    serviceId: string,
    input: DockerSelfUpdateServiceUpdate,
  ): Promise<void>;
  removeServiceByName(serviceName: string, resourceId: string): Promise<void>;
  forceServiceUpdate(serviceName: string): Promise<void>;
  getServiceLogs(serviceName: string, tail: number): Promise<string>;
  execServiceCommand(
    serviceName: string,
    command: readonly string[],
  ): Promise<void>;
  inspectNetwork(networkName: string): Promise<{
    driver: string;
    attachable: boolean;
  }>;
  getInfo(): ReturnType<DockerSwarmManagementPort["getInfo"]>;
  inspectSwarm(): ReturnType<DockerSwarmManagementPort["inspectSwarm"]>;
  listNodes(): ReturnType<DockerSwarmManagementPort["listNodes"]>;
  listTasks(): ReturnType<DockerSwarmManagementPort["listTasks"]>;
  initialize: DockerSwarmManagementPort["initialize"];
  updateSwarm: DockerSwarmManagementPort["updateSwarm"];
  inspectNode: DockerSwarmManagementPort["inspectNode"];
  updateNode: DockerSwarmManagementPort["updateNode"];
  removeNode: DockerSwarmManagementPort["removeNode"];
  ensureUpstandNetwork: DockerSwarmManagementPort["ensureUpstandNetwork"];
  cleanupDocker(
    command: DockerCleanupCommand,
    options: { preserveRollbackImages?: boolean; pruneNetworks?: boolean },
  ): Promise<void>;
  checkGpuStatus(): Promise<DockerGpuStatus>;
  setupGpuSupport(): Promise<void>;
  sanitizeName(name: string): string;
  setCancellationKey(key: string | null): void;
  deployDatabase(
    resource: Resource,
    envVars: Record<string, string>,
    onLog?: (log: string) => void,
    constraints?: string[],
  ): Promise<void>;
  deployAppImage(
    resource: Resource,
    envVars: Record<string, string>,
    onLog?: (log: string) => void,
    constraints?: string[],
    registryAuth?: DockerRegistryAuth,
    revision?: DeploymentRevisionOptions,
  ): Promise<void>;
  deployAppGit(
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
    destination?: DockerApiTarget,
    sourceRevision?: string,
    onGitCloned?: (clonePath: string) => Promise<Resource | undefined>,
    revision?: DeploymentRevisionOptions,
    buildEnvVars?: Record<string, string>,
    gitEnvironment?: Record<string, string>,
    sshHostKeyFingerprint?: string,
    onBuildResolved?: (artifact: ResolvedBuildArtifact) => Promise<void>,
  ): Promise<void>;
  readComposeFileFromGit(
    resource: Resource,
    cloneUrl: string,
    onLog: (log: string) => void,
    sshKeyPath?: string,
    sourceRevision?: string,
    gitEnvironment?: Record<string, string>,
    sshHostKeyFingerprint?: string,
  ): Promise<string>;
  deployComposeStack(
    resource: Resource,
    rawCompose: string,
    onLog: (log: string) => void,
    constraints?: string[],
    envVars?: Record<string, string>,
  ): Promise<void>;
  waitForServiceConvergence(
    resource: Resource,
    options?: ConvergenceOptions,
  ): Promise<ConvergenceResult>;
  runPostDeploySmokeTest(
    resource: Resource,
    onLog?: (log: string) => void,
  ): Promise<ConvergenceResult | null>;
  transferImage(
    imageName: string,
    targetDocker: DockerApiTarget,
    onLog?: (log: string) => void,
  ): Promise<void>;
  controlService(
    resource: Resource,
    command: "start" | "stop" | "restart",
  ): Promise<void>;
  rollbackService(
    resource: Resource,
    auth?: DockerRegistryAuth,
    serviceNameOverride?: string,
  ): Promise<void>;
  promoteServiceRevision(
    resource: Resource,
    revisionServiceName: string,
  ): Promise<void>;
  removeServiceRevision(
    resource: Resource,
    revisionServiceName: string,
  ): Promise<void>;
  scaleService(
    resource: ResourceAutoscalingProjection,
    replicas: number,
  ): Promise<void>;
  configureDatabaseReplication(
    resource: Resource,
    envVars: Record<string, string>,
  ): Promise<void>;
  serviceExists?(
    resource: Resource,
    serviceNameOverride?: string,
  ): Promise<boolean>;
  execContainerCommand?(
    target: DockerInspectionTarget,
    serviceName: string,
    command: string,
    options?: { timeoutSeconds?: number; onLog?: (chunk: string) => void },
    resourceId?: string,
  ): Promise<{ output?: string; stderr?: string; exitCode?: number }>;
  controlContainer(
    resource: Resource,
    containerId: string,
    command: "start" | "stop" | "restart" | "kill",
  ): Promise<void>;
  getContainers(
    resource: ResourceAutoscalingProjection,
  ): Promise<DockerResourceContainer[]>;
  getRoutingServices(resource: Resource): Promise<string[]>;
  getLogs(
    resource: Resource,
    containerId?: string,
    tail?: number,
    since?: number,
    filter?: { search?: string; levels?: DockerLogLevel[] },
  ): Promise<string>;
  getContainerStats(containerId: string): Promise<ContainerRuntimeStats>;
  getServerRuntimeStats(): Promise<ServerRuntimeStats>;
  removeResource(resource: Resource, deleteVolumes?: boolean): Promise<void>;
  removeDatabase(resource: Resource): Promise<void>;
  runCommandInResourceContainer(
    resource: Resource,
    command: string,
    target?: DockerApiTarget,
    options?: {
      timeoutSeconds?: number;
      maxOutputBytes?: number;
    },
  ): Promise<string>;
}

export type DockerCleanupCommand =
  | "images"
  | "volumes"
  | "containers"
  | "builder"
  | "system"
  | "all";

export interface DockerGpuStatus {
  driverInstalled: boolean;
  driverVersion?: string;
  gpuModel?: string;
  memoryInfo?: string;
  runtimeInstalled: boolean;
  runtimeConfigured: boolean;
  cudaSupport: boolean;
  cudaVersion?: string;
  availableGPUs: number;
  swarmEnabled: boolean;
  gpuResources: number;
}

export interface DockerHostMaintenancePort {
  cleanupDocker(
    command: DockerCleanupCommand,
    options: { preserveRollbackImages?: boolean; pruneNetworks?: boolean },
  ): Promise<void>;
  checkGpuStatus(): Promise<DockerGpuStatus>;
  setupGpuSupport(): Promise<void>;
}

export type DockerCleanupPort = Pick<
  DockerHostMaintenancePort,
  "cleanupDocker"
>;

export interface DockerSelfUpdateServiceSummary {
  id: string;
  name: string;
}

export interface DockerSelfUpdateTaskTemplate {
  [key: string]: unknown;
  ContainerSpec?: {
    [key: string]: unknown;
    Image?: string;
    Env?: string[];
  };
  ForceUpdate?: number;
}

export interface DockerSelfUpdateServiceInspection {
  version: number;
  name: string;
  taskTemplate: DockerSelfUpdateTaskTemplate;
  updateConfig?: Record<string, unknown>;
  rollbackConfig?: Record<string, unknown>;
  endpointSpec?: Record<string, unknown>;
}

export interface DockerSelfUpdateServiceUpdate {
  version: number;
  name: string;
  taskTemplate: DockerSelfUpdateTaskTemplate;
  updateConfig?: Record<string, unknown>;
  rollbackConfig?: Record<string, unknown>;
  endpointSpec?: Record<string, unknown>;
}

export interface DockerSelfUpdateInput {
  version: string;
  repository: string;
  images: {
    server: string;
    schedules: string;
    web: string;
    fumadocs: string;
    monitoring: string;
  };
}

/** Capabilities consumed by individual application workflows. */
export type DockerDeploymentPort = Pick<
  DockerServicePort,
  | "sanitizeName"
  | "setCancellationKey"
  | "deployDatabase"
  | "deployAppImage"
  | "deployAppGit"
  | "readComposeFileFromGit"
  | "deployComposeStack"
  | "waitForServiceConvergence"
  | "runPostDeploySmokeTest"
  | "rollbackService"
  | "promoteServiceRevision"
  | "removeServiceRevision"
  | "transferImage"
  | "configureDatabaseReplication"
  | "serviceExists"
  | "execContainerCommand"
  | "runCommandInResourceContainer"
>;
export type DockerResourceReadPort = Pick<
  DockerServicePort,
  "getContainers" | "getRoutingServices" | "getLogs" | "getContainerStats"
>;
export type DockerResourceControlPort = Pick<
  DockerServicePort,
  "controlService" | "rollbackService" | "removeResource" | "removeDatabase"
>;
export type DockerDatabaseDeploymentPort = Pick<
  DockerServicePort,
  "removeDatabase" | "deployDatabase"
>;
export type DockerContainerControlPort = Pick<
  DockerServicePort,
  "controlContainer"
>;
export type DockerCommandPort = Pick<
  DockerServicePort,
  "runCommandInResourceContainer"
>;
export type DockerServerStatsPort = Pick<
  DockerServicePort,
  "getServerRuntimeStats"
>;
export type DockerSelfUpdatePort = Pick<
  DockerServicePort,
  "listServices" | "inspectService" | "updateService"
> & {
  /** Typed broker path used for production self-update mutation. */
  applySelfUpdate?: (
    input: DockerSelfUpdateInput,
  ) => Promise<{ updatedCount: number }>;
};
export type DockerPreviewCleanupPort = Pick<
  DockerServicePort,
  "removeServiceByName"
>;
export interface DockerWebServerMaintenancePort {
  forceServiceUpdate(serviceName: string): Promise<void>;
  getServiceLogs(serviceName: string, tail: number): Promise<string>;
  execServiceCommand(
    serviceName: string,
    command: readonly string[],
  ): Promise<void>;
  inspectNetwork(networkName: string): Promise<{
    driver: string;
    attachable: boolean;
  }>;
}
export type DockerWorkloadMigrationPort = Pick<
  DockerServicePort,
  | "sanitizeName"
  | "deployAppImage"
  | "waitForServiceConvergence"
  | "runPostDeploySmokeTest"
  | "removeResource"
  | "getServerRuntimeStats"
  | "serviceExists"
>;
export type DockerAutoscalingPort = Pick<
  DockerServicePort,
  "getContainers" | "scaleService"
>;

export type DockerInspectionTarget =
  | { kind: "local"; name: string }
  | {
      kind: "remote";
      name: string;
      host: string;
      port: number;
      username: string;
      privateKey?: string;
      password?: string;
      hostKeyFingerprint?: string;
    };

export interface DockerInfo {
  name: string;
  serverVersion: string;
  operatingSystem: string;
  architecture: string;
  containers: number;
  images: number;
  memoryBytes: number;
  swarmState: string;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  mounts: string[];
  networks: string[];
  labels: string[];
  createdAt: string | null;
}

export interface DockerImage {
  id: string;
  tags: string[];
  sizeBytes: number;
  createdAt: string | null;
}

export interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  attachable: boolean;
}

export interface DockerServiceSummary {
  id: string;
  name: string;
  mode: string;
  replicas: string;
  image: string;
  ports: string;
}

export interface DockerContainerStats {
  containerId: string;
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  pids: number;
}

export interface DockerLogRequest {
  containerId?: string;
  serviceName?: string;
  tail: number;
  since?: number;
  search?: string;
  levels?: DockerLogLevel[];
}

export type DockerContainerCommand = "restart" | "stop" | "start" | "remove";
export type DockerResourceCommand =
  | "remove-volume"
  | "remove-network"
  | "remove-image";
export type DockerPruneType =
  | "images"
  | "volumes"
  | "containers"
  | "builder"
  | "networks"
  | "system"
  | "all";

export interface DockerPruneOptions {
  preserveRollbackImages?: boolean;
  pruneNetworks?: boolean;
}

export interface DockerInventoryReaderPort {
  listSwarmNodes(target: DockerInspectionTarget): Promise<
    Array<{
      id: string;
      hostname: string;
      ip: string;
      isLeader: boolean;
      status?: string;
      serverType?: string;
      role?: string;
      isLocalNode?: boolean;
    }>
  >;
  getInfo(target: DockerInspectionTarget): Promise<DockerInfo>;
  getHostTime(
    target: DockerInspectionTarget,
  ): Promise<{ epochSeconds: number; iso: string }>;
  listContainers(
    target: DockerInspectionTarget,
    options?: { search?: string; state?: string },
  ): Promise<DockerContainer[]>;
  listImages(target: DockerInspectionTarget): Promise<DockerImage[]>;
  listVolumes(target: DockerInspectionTarget): Promise<DockerVolume[]>;
  listNetworks(target: DockerInspectionTarget): Promise<DockerNetwork[]>;
  listServices(target: DockerInspectionTarget): Promise<DockerServiceSummary[]>;
  getLogs(
    target: DockerInspectionTarget,
    request: DockerLogRequest,
  ): Promise<string>;
  getContainerStats(
    target: DockerInspectionTarget,
    containerId: string,
  ): Promise<DockerContainerStats>;
}

export interface DockerContainerControllerPort {
  controlContainer(
    target: DockerInspectionTarget,
    containerId: string,
    command: DockerContainerCommand,
  ): Promise<{ success: true }>;
}

export interface DockerResourceControllerPort {
  controlResource(
    target: DockerInspectionTarget,
    resourceId: string,
    command: DockerResourceCommand,
  ): Promise<{ success: true }>;
}

export interface DockerPrunePort {
  prune(
    target: DockerInspectionTarget,
    type: DockerPruneType,
    options?: DockerPruneOptions,
  ): Promise<{ success: true; output: string[] }>;
}

export interface DockerExecPort {
  execContainerCommand(
    target: DockerInspectionTarget,
    containerId: string,
    command: string,
    options?: { timeoutSeconds?: number; onLog?: (chunk: string) => void },
    resourceId?: string,
  ): Promise<{ output: string; stderr?: string; exitCode?: number }>;
  execServerTerminalCommand(
    target: DockerInspectionTarget,
    command: string,
  ): Promise<{ output: string }>;
}

export interface DockerArchiveTransferPort {
  uploadArchiveToVolume(
    target: DockerInspectionTarget,
    volumeName: string,
    archive: Buffer,
    destination: string,
  ): Promise<{ success: true; bytes: number; destination: string }>;
  uploadArchiveToContainer(
    target: DockerInspectionTarget,
    containerId: string,
    archive: Buffer,
    destination: string,
  ): Promise<{ success: true; bytes: number; destination: string }>;
}

export interface RemoteDockerConnectionPort {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
  hostKeyFingerprint?: string;
}

export interface DockerInfrastructureResolverPort {
  resolveCaddyServiceForServer(
    serverId: string,
    uow: import("@upstand/domain").IUnitOfWork,
  ): Promise<{ caddyService: CaddyServicePort; cleanup: () => void }>;
  resolveDockerServiceForServer(
    serverId: string | null | undefined,
    uow: import("@upstand/domain").IUnitOfWork,
    defaultDockerService: DockerServicePort,
  ): Promise<{ dockerService: DockerServicePort; cleanup: () => void }>;
  resolveDockerCliEnvironmentForServer(
    serverId: string | null | undefined,
    uow: import("@upstand/domain").IUnitOfWork,
  ): Promise<{
    environment: Record<string, string | undefined>;
    cleanup: () => void;
  }>;
  resolveServicesForResource(
    resource: ResourceAutoscalingProjection,
    uow: import("@upstand/domain").IUnitOfWork,
    defaultDockerService: DockerServicePort,
    defaultCaddyService: CaddyServicePort,
  ): Promise<{
    dockerService: DockerServicePort;
    caddyService: CaddyServicePort;
    cleanup: () => void;
  }>;
  createRemoteServices(connection: RemoteDockerConnectionPort): {
    docker: DockerApiTarget;
    dockerService: DockerServicePort;
    caddyService: CaddyServicePort;
    cli: {
      environment: Record<string, string | undefined>;
      cleanup: () => void;
    };
    info(): Promise<unknown>;
  };
}
