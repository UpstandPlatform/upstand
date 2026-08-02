import { TRPCError } from "@trpc/server";
import {
  getConfiguredControlPlaneMode,
  getPlatformCapabilities,
  type PlatformCapabilities,
} from "@upstand/usecases/platform/platform.types";

/**
 * Returns the current runtime capabilities for the configured control-plane
 * mode. Cached per-process via the module-level singleton in platform.types.
 */
export function getRuntimeCapabilities(): PlatformCapabilities {
  return getPlatformCapabilities(getConfiguredControlPlaneMode());
}

/**
 * Asserts that a specific capability is enabled for the current runtime.
 * Throws a tRPC FORBIDDEN error with a clear message if it is not.
 *
 * Use this at the top of any router handler that should be unavailable in
 * certain runtimes (e.g. SCIM/SSO in Desktop, Swarm in cloud/desktop).
 *
 * @example
 *   requireCapability("enterpriseScimSso", "SCIM provisioning");
 */
export function requireCapability(
  capability: keyof PlatformCapabilities,
  featureName: string,
): void {
  const caps = getRuntimeCapabilities();
  if (!caps[capability]) {
    const mode = getConfiguredControlPlaneMode();
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${featureName} is not available in '${mode}' mode.`,
      cause: `CAPABILITY_UNAVAILABLE:${capability}`,
    });
  }
}
