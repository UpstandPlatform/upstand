import { useCallback, useState } from "react";
import type { DGEdge, DGNode } from "../types";

export function useDetailPanel(dgNodes: DGNode[], _dgEdges: DGEdge[]) {
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);

  const selectedNode = dgNodes.find((n) => n.id === detailNodeId) ?? null;

  const handleInfoClick = useCallback((nodeId: string) => {
    setDetailNodeId(nodeId);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailNodeId(null);
  }, []);

  return {
    detailNodeId,
    detailOpen: Boolean(selectedNode),
    selectedNode,
    handleInfoClick,
    closeDetail,
  };
}
