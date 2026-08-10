import type {
  ArtifactIdentity,
  DeploymentPlan,
  ExecutionRuntime,
  Resource,
} from "@upstand/domain";

export interface RuntimeDeploymentRequest {
  deploymentId: string;
  plan: DeploymentPlan;
  resource: Resource;
  environment: Readonly<Record<string, string>>;
  onLog?: (line: string) => void;
}

export interface RuntimeDeploymentResult {
  runtimeId: string;
  endpoint: string | null;
  artifact: ArtifactIdentity;
}

export interface RuntimeHealth {
  healthy: boolean;
  state: string;
  message: string | null;
}

/** Runtime-neutral workload execution boundary. Runtime-specific APIs stay in
 * infrastructure adapters and cannot leak into deployment orchestration. */
export interface WorkloadRuntimePort {
  readonly runtime: ExecutionRuntime;
  deploy(request: RuntimeDeploymentRequest): Promise<RuntimeDeploymentResult>;
  health(resource: Resource): Promise<RuntimeHealth>;
  logs(resource: Resource, tail: number): Promise<string>;
  rollback(request: RuntimeDeploymentRequest): Promise<void>;
  remove(resource: Resource): Promise<void>;
}

export interface RoutingTlsPort {
  stage(input: {
    deploymentId: string;
    resource: Resource;
    endpoint: string;
  }): Promise<string>;
  commit(changeId: string): Promise<void>;
  rollback(changeId: string): Promise<void>;
}

export interface ArtifactTransferPort {
  ensureAvailable(input: {
    artifact: ArtifactIdentity;
    source: string;
    destination: string;
    onProgress?: (completedBytes: number, totalBytes: number | null) => void;
  }): Promise<void>;
}

export interface StateTransferPort {
  readonly kind: string;
  preflight(input: {
    resource: Resource;
    source: string;
    destination: string;
  }): Promise<ReadonlyArray<{ code: string; ok: boolean; message: string }>>;
  transfer(input: {
    resource: Resource;
    source: string;
    destination: string;
    resumeToken: string | null;
    onCheckpoint: (
      resumeToken: string,
      completedBytes: number,
    ) => Promise<void>;
  }): Promise<void>;
  verify(input: {
    resource: Resource;
    source: string;
    destination: string;
  }): Promise<{ checksum: string; consistent: boolean }>;
}

export interface ProcessSupervisorPort {
  readonly platform: "linux" | "macos" | "windows";
  install(input: {
    name: string;
    executable: string;
    args: readonly string[];
    workingDirectory: string;
    environmentFile: string;
    restartPolicy: "never" | "on-failure" | "always";
  }): Promise<void>;
  status(name: string): Promise<RuntimeHealth>;
  logs(name: string, tail: number): Promise<string>;
  restart(name: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export interface BareArtifactMaterializerPort {
  materialize(input: {
    deploymentId: string;
    artifact: ArtifactIdentity;
    resource: Resource;
    environment: Readonly<Record<string, string>>;
  }): Promise<{
    executable: string;
    args: readonly string[];
    workingDirectory: string;
    environmentFile: string;
  }>;
}

export const CLOUD_GATEWAY_CONTRACT_VERSION = "2026-08-01";

export interface CloudGatewayPort {
  readonly contractVersion: typeof CLOUD_GATEWAY_CONTRACT_VERSION;
  deploy(input: {
    idempotencyKey: string;
    cloudProjectId: string;
    plan: DeploymentPlan;
  }): Promise<RuntimeDeploymentResult>;
  health(cloudProjectId: string, resourceId: string): Promise<RuntimeHealth>;
  logs(
    cloudProjectId: string,
    resourceId: string,
    tail: number,
  ): Promise<string>;
  rollback(input: {
    idempotencyKey: string;
    cloudProjectId: string;
    plan: DeploymentPlan;
  }): Promise<void>;
  remove(input: {
    idempotencyKey: string;
    cloudProjectId: string;
    resourceId: string;
  }): Promise<void>;
  promote(input: {
    idempotencyKey: string;
    projectId: string;
  }): Promise<{ cloudProjectId: string }>;
  bringHome(input: {
    idempotencyKey: string;
    cloudProjectId: string;
  }): Promise<{ transferId: string }>;
}

export class RuntimeAdapterUnavailableError extends Error {
  readonly code = "RUNTIME_ADAPTER_UNAVAILABLE";

  constructor(readonly runtime: ExecutionRuntime) {
    super(`Runtime adapter '${runtime}' is not configured`);
    this.name = "RuntimeAdapterUnavailableError";
  }
}

export class RuntimeAdapterRegistry {
  private readonly adapters: ReadonlyMap<ExecutionRuntime, WorkloadRuntimePort>;

  constructor(adapters: readonly WorkloadRuntimePort[]) {
    const entries = new Map<ExecutionRuntime, WorkloadRuntimePort>();
    for (const adapter of adapters) {
      if (entries.has(adapter.runtime)) {
        throw new Error(`Duplicate runtime adapter '${adapter.runtime}'`);
      }
      entries.set(adapter.runtime, adapter);
    }
    this.adapters = entries;
  }

  supports(runtime: ExecutionRuntime): boolean {
    return this.adapters.has(runtime);
  }

  resolve(runtime: ExecutionRuntime): WorkloadRuntimePort {
    const adapter = this.adapters.get(runtime);
    if (!adapter) throw new RuntimeAdapterUnavailableError(runtime);
    return adapter;
  }
}
