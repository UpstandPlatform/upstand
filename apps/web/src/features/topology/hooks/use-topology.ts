import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import type { DGEdge, DGNode } from "../types";

export const TOPOLOGY_LIVE_REFRESH_INTERVAL_MS = 30_000;

export function getTopologyRefetchInterval(isLive: boolean): number | false {
  return isLive ? TOPOLOGY_LIVE_REFRESH_INTERVAL_MS : false;
}

export interface UseTopologyOptions {
  organizationId: string;
  serverId?: string;
  isLive?: boolean;
}

export function useTopology({
  organizationId,
  serverId,
  isLive = true,
}: UseTopologyOptions) {
  const query = useQuery({
    ...trpc.topology.getGraph.queryOptions({
      organizationId,
      serverId: serverId && serverId !== "all" ? serverId : undefined,
    }),
    enabled: Boolean(organizationId),
    refetchInterval: getTopologyRefetchInterval(isLive),
  });

  const nodes: DGNode[] = query.data?.nodes ?? [];
  const edges: DGEdge[] = query.data?.edges ?? [];

  return {
    nodes,
    edges,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refetch: query.refetch,
    updatedAt: query.data?.updatedAt,
  };
}
