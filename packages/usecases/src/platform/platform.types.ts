import { env } from "@upstand/env/server";
import { z } from "zod";

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
]);

export type DeploymentPlacement = z.infer<typeof DeploymentPlacementSchema>;

export const PlatformCapabilitiesSchema = z.object({
  mode: ControlPlaneModeSchema,
  localRuntime: z.boolean(),
  remoteServers: z.boolean(),
  localEdge: z.boolean(),
  remoteEdge: z.boolean(),
  scheduler: z.boolean(),
  redis: z.boolean(),
  cloudConnection: z.boolean(),
  jobs: z.boolean(),
});

export type PlatformCapabilities = z.infer<typeof PlatformCapabilitiesSchema>;

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
        localEdge: true,
        remoteEdge: true,
        scheduler: true,
        redis: false,
        cloudConnection: true,
        jobs: true,
      };
    case "cloud":
      return {
        mode,
        localRuntime: false,
        remoteServers: true,
        localEdge: false,
        remoteEdge: true,
        scheduler: true,
        redis: true,
        cloudConnection: false,
        jobs: true,
      };
    case "self-hosted":
      return {
        mode,
        localRuntime: true,
        remoteServers: true,
        localEdge: true,
        remoteEdge: true,
        scheduler: true,
        redis: true,
        cloudConnection: true,
        jobs: true,
      };
  }
}
