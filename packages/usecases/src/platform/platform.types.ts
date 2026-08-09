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
  dataOwnership: DataOwnershipSchema,
  runtimeMatrix: z.array(RuntimeCapabilitySchema),
});

export type PlatformCapabilities = z.infer<typeof PlatformCapabilitiesSchema>;

const SELF_HOSTED_RUNTIME_MATRIX: RuntimeCapability[] = [
  {
    target: "local",
    runtime: "docker",
    supported: true,
    buildLocations: ["control-plane", "target", "remote-builder"],
    zeroDowntimeReplacement: true,
    reason: null,
  },
  {
    target: "local",
    runtime: "bare-process",
    supported: true,
    buildLocations: ["control-plane", "target"],
    zeroDowntimeReplacement: false,
    reason: null,
  },
  {
    target: "remote-server",
    runtime: "docker",
    supported: true,
    buildLocations: ["control-plane", "target", "remote-builder"],
    zeroDowntimeReplacement: true,
    reason: null,
  },
  {
    target: "remote-server",
    runtime: "bare-process",
    supported: true,
    buildLocations: ["control-plane", "target", "remote-builder"],
    zeroDowntimeReplacement: false,
    reason: null,
  },
  {
    target: "cloud",
    runtime: "cloud",
    supported: true,
    buildLocations: ["cloud"],
    zeroDowntimeReplacement: true,
    reason: null,
  },
];

const CLOUD_RUNTIME_MATRIX: RuntimeCapability[] = [
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
  ...SELF_HOSTED_RUNTIME_MATRIX.filter(
    (capability) => capability.target !== "local",
  ),
];

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
  const parsed = ControlPlaneModeSchema.safeParse(input.platform);
  if (parsed.success) return parsed.data;
  return input.isCloud ? "cloud" : "self-hosted";
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
): PlatformCapabilities {
  switch (mode) {
    case "desktop":
      return {
        mode,
        localRuntime: true,
        remoteServers: true,
        scheduler: true,
        redis: false,
        cloudConnection: true,
        jobs: true,
        acmeCertificates: false,
        localGitCli: true,
        localDockerSocket: true,
        swarmManagement: false,
        localFileSystemBackups: true,
        embeddedMonitoring: true,
        desktopNativeNotifications: true,
        enterpriseScimSso: false,
        serverMigration: true,
        dataOwnership: "local-control-plane",
        runtimeMatrix: SELF_HOSTED_RUNTIME_MATRIX,
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
        dataOwnership: "cloud-control-plane",
        runtimeMatrix: CLOUD_RUNTIME_MATRIX,
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
        dataOwnership: "local-control-plane",
        runtimeMatrix: SELF_HOSTED_RUNTIME_MATRIX,
      };
  }
}

export function getRuntimeCapability(
  mode: ControlPlaneMode,
  target: DeployTarget,
  runtime: ExecutionRuntime,
): RuntimeCapability | null {
  return (
    getPlatformCapabilities(mode).runtimeMatrix.find(
      (entry) => entry.target === target && entry.runtime === runtime,
    ) ?? null
  );
}

export function assertRuntimeCapability(input: {
  mode: ControlPlaneMode;
  target: DeployTarget;
  runtime: ExecutionRuntime;
  buildLocation: BuildLocation;
}): RuntimeCapability {
  const capability = getRuntimeCapability(
    input.mode,
    input.target,
    input.runtime,
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
