import {
  type BuildLocation,
  BuildLocationSchema,
  DataOwnershipSchema,
  type DeployTarget,
  DeployTargetSchema,
  type ExecutionRuntime,
  ExecutionRuntimeSchema,
} from "@upstand/domain";
import { env } from "@upstand/env/server";
import { z } from "zod";

export type {
  BuildLocation,
  DataOwnership,
  DeployTarget,
  ExecutionRuntime,
} from "@upstand/domain";
export {
  BuildLocationSchema,
  DataOwnershipSchema,
  DeployTargetSchema,
  ExecutionRuntimeSchema,
};

export const ControlPlaneModeSchema = z.enum([
  "desktop",
  "self-hosted",
  "cloud",
]);

export type ControlPlaneMode = z.infer<typeof ControlPlaneModeSchema>;

export const DeploymentPlacementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local") }),
  z.object({
    kind: z.literal("remote-server"),
    serverId: z.string().min(1),
    buildServerId: z.string().min(1).nullable().optional(),
  }),
  z.object({
    kind: z.literal("cloud"),
    cloudProjectId: z.string().min(1),
  }),
]);

export type DeploymentPlacement = z.infer<typeof DeploymentPlacementSchema>;

export const RuntimeCapabilitySchema = z.object({
  target: DeployTargetSchema,
  runtime: ExecutionRuntimeSchema,
  supported: z.boolean(),
  buildLocations: z.array(BuildLocationSchema),
  zeroDowntimeReplacement: z.boolean(),
  reason: z.string().nullable(),
});

export type RuntimeCapability = z.infer<typeof RuntimeCapabilitySchema>;

export interface RuntimeAdapterAvailability {
  readonly docker: boolean;
  readonly bareProcess: boolean;
  readonly cloudGateway: boolean;
}

const DEFAULT_RUNTIME_ADAPTER_AVAILABILITY: RuntimeAdapterAvailability = {
  docker: true,
  bareProcess: false,
  cloudGateway: false,
};

export const PlatformCapabilitiesSchema = z.object({
  mode: ControlPlaneModeSchema,
  localRuntime: z.boolean(),
  remoteServers: z.boolean(),
  scheduler: z.boolean(),
  redis: z.boolean(),
  cloudConnection: z.boolean(),
  jobs: z.boolean(),
  acmeCertificates: z.boolean(),
  localGitCli: z.boolean(),
  localDockerSocket: z.boolean(),
  swarmManagement: z.boolean(),
  localFileSystemBackups: z.boolean(),
  embeddedMonitoring: z.boolean(),
  desktopNativeNotifications: z.boolean(),
  enterpriseScimSso: z.boolean(),
  serverMigration: z.boolean(),
  controlPlaneTransfer: z.boolean(),
  dataOwnership: DataOwnershipSchema,
  runtimeMatrix: z.array(RuntimeCapabilitySchema),
});

export type PlatformCapabilities = z.infer<typeof PlatformCapabilitiesSchema>;

function createSelfHostedRuntimeMatrix(
  availability: RuntimeAdapterAvailability,
): RuntimeCapability[] {
  return [
    {
      target: "local",
      runtime: "docker",
      supported: availability.docker,
      buildLocations: availability.docker
        ? ["control-plane", "target", "remote-builder"]
        : [],
      zeroDowntimeReplacement: true,
      reason: availability.docker
        ? null
        : "Docker execution is unavailable because no Docker runtime adapter is configured",
    },
    {
      target: "local",
      runtime: "bare-process",
      supported: availability.bareProcess,
      buildLocations: availability.bareProcess
        ? ["control-plane", "target"]
        : [],
      zeroDowntimeReplacement: false,
      reason: availability.bareProcess
        ? null
        : "Bare-process execution is unavailable because no process supervisor and artifact materializer are configured",
    },
    {
      target: "remote-server",
      runtime: "docker",
      supported: availability.docker,
      buildLocations: availability.docker
        ? ["control-plane", "target", "remote-builder"]
        : [],
      zeroDowntimeReplacement: true,
      reason: availability.docker
        ? null
        : "Docker execution is unavailable because no Docker runtime adapter is configured",
    },
    {
      target: "remote-server",
      runtime: "bare-process",
      supported: availability.bareProcess,
      buildLocations: availability.bareProcess
        ? ["control-plane", "target", "remote-builder"]
        : [],
      zeroDowntimeReplacement: false,
      reason: availability.bareProcess
        ? null
        : "Bare-process execution is unavailable because no process supervisor and artifact materializer are configured",
    },
    {
      target: "cloud",
      runtime: "cloud",
      supported: availability.cloudGateway,
      buildLocations: availability.cloudGateway ? ["cloud"] : [],
      zeroDowntimeReplacement: true,
      reason: availability.cloudGateway
        ? null
        : "Cloud execution is unavailable because no cloud gateway is configured",
    },
  ];
}

function createCloudRuntimeMatrix(
  availability: RuntimeAdapterAvailability,
): RuntimeCapability[] {
  return [
    {
      target: "local",
      runtime: "docker",
      supported: false,
      buildLocations: [],
      zeroDowntimeReplacement: false,
      reason: "Cloud control planes cannot execute workloads locally",
    },
    {
      target: "local",
      runtime: "bare-process",
      supported: false,
      buildLocations: [],
      zeroDowntimeReplacement: false,
      reason: "Cloud control planes cannot execute workloads locally",
    },
    ...createSelfHostedRuntimeMatrix(availability).filter(
      (capability) => capability.target !== "local",
    ),
  ];
}

function createDesktopRuntimeMatrix(
  availability: RuntimeAdapterAvailability,
): RuntimeCapability[] {
  return [
    {
      target: "local",
      runtime: "docker",
      supported: false,
      buildLocations: [],
      zeroDowntimeReplacement: false,
      reason: "Desktop uses bare mode and does not execute workloads locally",
    },
    {
      target: "local",
      runtime: "bare-process",
      supported: false,
      buildLocations: [],
      zeroDowntimeReplacement: false,
      reason:
        "Desktop bare mode is a control plane, not a local workload runtime",
    },
    {
      target: "remote-server",
      runtime: "docker",
      supported: availability.docker,
      buildLocations: availability.docker
        ? ["control-plane", "target", "remote-builder"]
        : [],
      zeroDowntimeReplacement: true,
      reason: availability.docker
        ? null
        : "Docker execution is unavailable because no Docker runtime adapter is configured",
    },
    {
      target: "remote-server",
      runtime: "bare-process",
      supported: availability.bareProcess,
      buildLocations: availability.bareProcess
        ? ["control-plane", "target", "remote-builder"]
        : [],
      zeroDowntimeReplacement: false,
      reason: availability.bareProcess
        ? null
        : "Bare-process execution is unavailable because no process supervisor and artifact materializer are configured",
    },
    {
      target: "cloud",
      runtime: "cloud",
      supported: availability.cloudGateway,
      buildLocations: availability.cloudGateway ? ["cloud"] : [],
      zeroDowntimeReplacement: true,
      reason: availability.cloudGateway
        ? null
        : "Cloud execution is unavailable because no cloud gateway is configured",
    },
  ];
}

export class PlatformCapabilityError extends Error {
  readonly code = "PLATFORM_CAPABILITY_UNSUPPORTED";

  constructor(
    public readonly target: DeployTarget,
    public readonly runtime: ExecutionRuntime,
    public readonly buildLocation: BuildLocation,
    reason: string,
  ) {
    super(reason);
    this.name = "PlatformCapabilityError";
  }
}

export function resolveControlPlaneMode(input: {
  platform?: string;
  isCloud: boolean;
}): ControlPlaneMode {
  if (input.isCloud) return "cloud";
  const parsed = ControlPlaneModeSchema.safeParse(input.platform);
  if (parsed.success) return parsed.data;
  return "self-hosted";
}

/** Resolve the mode once at the application boundary so feature policy does
 * not grow independent IS_CLOUD checks throughout individual use cases. */
export function getConfiguredControlPlaneMode(): ControlPlaneMode {
  return resolveControlPlaneMode({
    platform: env.UPSTAND_PLATFORM,
    isCloud: env.IS_CLOUD,
  });
}

export function requiresRemoteServerPlacement(): boolean {
  return getConfiguredControlPlaneMode() === "cloud";
}

export function getPlatformCapabilities(
  mode: ControlPlaneMode,
  runtimeAvailability: RuntimeAdapterAvailability = DEFAULT_RUNTIME_ADAPTER_AVAILABILITY,
): PlatformCapabilities {
  const selfHostedRuntimeMatrix =
    createSelfHostedRuntimeMatrix(runtimeAvailability);
  switch (mode) {
    case "desktop":
      return {
        mode,
        localRuntime: false,
        remoteServers: true,
        scheduler: false,
        redis: false,
        cloudConnection: true,
        jobs: false,
        acmeCertificates: false,
        localGitCli: false,
        localDockerSocket: false,
        swarmManagement: false,
        localFileSystemBackups: false,
        embeddedMonitoring: false,
        desktopNativeNotifications: true,
        enterpriseScimSso: false,
        serverMigration: true,
        controlPlaneTransfer: true,
        dataOwnership: "local-control-plane",
        runtimeMatrix: createDesktopRuntimeMatrix(runtimeAvailability),
      };
    case "cloud":
      return {
        mode,
        localRuntime: false,
        remoteServers: true,
        scheduler: true,
        redis: true,
        cloudConnection: false,
        jobs: true,
        acmeCertificates: true,
        localGitCli: false,
        localDockerSocket: false,
        swarmManagement: false,
        localFileSystemBackups: false,
        embeddedMonitoring: false,
        desktopNativeNotifications: false,
        enterpriseScimSso: true,
        serverMigration: true,
        controlPlaneTransfer: false,
        dataOwnership: "cloud-control-plane",
        runtimeMatrix: createCloudRuntimeMatrix(runtimeAvailability),
      };
    case "self-hosted":
      return {
        mode,
        localRuntime: true,
        remoteServers: true,
        scheduler: true,
        redis: true,
        cloudConnection: true,
        jobs: true,
        acmeCertificates: true,
        localGitCli: false,
        localDockerSocket: true,
        swarmManagement: true,
        localFileSystemBackups: true,
        embeddedMonitoring: true,
        desktopNativeNotifications: false,
        enterpriseScimSso: true,
        serverMigration: true,
        controlPlaneTransfer: true,
        dataOwnership: "local-control-plane",
        runtimeMatrix: selfHostedRuntimeMatrix,
      };
  }
}

export function getRuntimeCapability(
  mode: ControlPlaneMode,
  target: DeployTarget,
  runtime: ExecutionRuntime,
  runtimeAvailability?: RuntimeAdapterAvailability,
): RuntimeCapability | null {
  return (
    getPlatformCapabilities(mode, runtimeAvailability).runtimeMatrix.find(
      (entry) => entry.target === target && entry.runtime === runtime,
    ) ?? null
  );
}

export function assertRuntimeCapability(input: {
  mode: ControlPlaneMode;
  target: DeployTarget;
  runtime: ExecutionRuntime;
  buildLocation: BuildLocation;
  runtimeAvailability?: RuntimeAdapterAvailability;
}): RuntimeCapability {
  const capability = getRuntimeCapability(
    input.mode,
    input.target,
    input.runtime,
    input.runtimeAvailability,
  );
  if (
    !capability?.supported ||
    !capability.buildLocations.includes(input.buildLocation)
  ) {
    throw new PlatformCapabilityError(
      input.target,
      input.runtime,
      input.buildLocation,
      capability?.reason ??
        `Runtime '${input.runtime}' with build location '${input.buildLocation}' is not supported for target '${input.target}' in '${input.mode}' mode`,
    );
  }
  return capability;
}
