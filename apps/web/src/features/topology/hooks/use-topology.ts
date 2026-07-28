import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import type { DGEdge, DGNode } from "../types";

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
    refetchInterval: isLive ? 5000 : false,
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
