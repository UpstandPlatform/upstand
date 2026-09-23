/**
 * Deployment cancellation markers.
 *
 * Self-hosted and cloud control planes run deployments in separate scheduler
 * processes, so the marker has to live in Redis. Desktop has no Redis and runs
 * the deployment inline in the API process, so the same marker is kept in
 * memory there. Both use the identical key so the build-command watchdog only
 * has to know about one identifier.
 */

const localCancellations = new Map<string, number>();

/** Matches the Redis marker TTL so an abandoned request cannot leak forever. */
const LOCAL_CANCELLATION_TTL_MS = 3_600_000;

export function deploymentCancellationKey(deploymentId: string): string {
  return `upstand:deployment:cancel:${deploymentId}`;
}

function prune(now: number): void {
  for (const [key, expiresAt] of localCancellations) {
    if (expiresAt <= now) localCancellations.delete(key);
  }
}

export function requestLocalDeploymentCancellation(key: string): void {
  const now = Date.now();
  prune(now);
  localCancellations.set(key, now + LOCAL_CANCELLATION_TTL_MS);
}

export function isLocalDeploymentCancellationRequested(key: string): boolean {
  const expiresAt = localCancellations.get(key);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    localCancellations.delete(key);
    return false;
  }
  return true;
}

export function clearLocalDeploymentCancellation(key: string): void {
  localCancellations.delete(key);
}
