import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";

export function useSelectionHighlight(
  nodes: RFNode[],
  edges: RFEdge[],
  matchingNodeIds?: Set<string>,
  hasFilter = false,
) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const connectedMap = useMemo(() => {
    if (!selectedNodeId) return null;
    const connectedNodes = new Set<string>([selectedNodeId]);
    const connectedEdges = new Set<string>();

    for (const e of edges) {
      if (e.source === selectedNodeId || e.target === selectedNodeId) {
        connectedEdges.add(e.id);
        connectedNodes.add(e.source);
        connectedNodes.add(e.target);
      }
    }

    return { connectedNodes, connectedEdges };
  }, [selectedNodeId, edges]);

  const connectedGroupIds = useMemo(() => {
    if (!connectedMap) return null;

    const groupIds = new Set<string>();
    for (const node of nodes) {
      if (node.parentId && connectedMap.connectedNodes.has(node.id)) {
        groupIds.add(node.parentId);
      }
    }
    return groupIds;
  }, [nodes, connectedMap]);

  const selectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
  }, []);

  const selectEdge = useCallback((edgeId: string | null) => {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
  }, []);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: RFNode) => {
      selectNode(node.id === selectedNodeId ? null : node.id);
    },
    [selectedNodeId, selectNode],
  );

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: RFEdge) => {
      selectEdge(edge.id === selectedEdgeId ? null : edge.id);
    },
    [selectedEdgeId, selectEdge],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  // Escape key unselects
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const styledNodes = useMemo(() => {
    const isSearching = hasFilter;

    return nodes.map((n) => {
      let opacity = 1;
      const selected = n.id === selectedNodeId;

      if (connectedMap) {
        const isConnected = connectedMap.connectedNodes.has(n.id);
        const isGroupOfConnectedChild =
          n.type === "networkGroup" && connectedGroupIds?.has(n.id);

        if (!isConnected && !isGroupOfConnectedChild) {
          opacity = 0.2;
        }
      } else if (isSearching) {
        if (!matchingNodeIds?.has(n.id) && n.type !== "networkGroup") {
          opacity = 0.25;
        }
      }

      return {
        ...n,
        selected,
        style: {
          ...n.style,
          opacity,
          transition: "opacity 0.2s ease-in-out",
        },
      };
    });
  }, [
    nodes,
    selectedNodeId,
    connectedMap,
    connectedGroupIds,
    matchingNodeIds,
    hasFilter,
  ]);

  const styledEdges = useMemo(() => {
    return edges.map((e) => {
      let opacity = 1;
      let strokeWidth = e.style?.strokeWidth ?? 2;
      const selected = e.id === selectedEdgeId;

      if (connectedMap) {
        if (connectedMap.connectedEdges.has(e.id)) {
          strokeWidth = 3.5;
        } else {
          opacity = 0.15;
        }
      } else if (selectedEdgeId) {
        if (e.id !== selectedEdgeId) {
          opacity = 0.15;
        } else {
          strokeWidth = 3.5;
        }
      }

      return {
        ...e,
        selected,
        style: {
          ...e.style,
          strokeWidth,
          opacity,
          transition: "opacity 0.2s ease-in-out, stroke-width 0.2s ease-in-out",
        },
      };
    });
  }, [edges, selectedEdgeId, connectedMap]);

  return {
    styledNodes,
    styledEdges,
    selectedNodeId,
    selectedEdgeId,
    onNodeClick,
    onEdgeClick,
    onPaneClick,
    selectNode,
    selectEdge,
  };
}
