/**
 * BullMQ reserves `:` for its own Redis key layout. Server IDs can be arbitrary
 * Docker node IDs, so encode them rather than interpolating them directly.
 */
export function getDeploymentQueueName(serverId: string): string {
  return `deployments-queue-${encodeURIComponent(serverId)}`;
}
