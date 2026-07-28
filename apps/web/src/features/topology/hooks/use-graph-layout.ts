import {
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
  type Edge as RFEdge,
  type Node as RFNode,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeLayout } from "../layout/elk-layout";
import type { DGEdge, DGNode } from "../types";
import { toReactFlowEdges, toReactFlowNodes } from "../utils/graph-transform";

function topologyKey(dgNodes: DGNode[], dgEdges: DGEdge[]): string {
  const nk = dgNodes
    .map((n) => `${n.id}:${n.type}:${n.networkId ?? ""}`)
    .sort()
    .join(",");
  const ek = dgEdges
    .map((e) => `${e.id}:${e.source}:${e.target}:${e.type}`)
    .sort()
    .join(",");
  return `${nk}|${ek}`;
}

export function useGraphLayout(
  dgNodes: DGNode[],
  dgEdges: DGEdge[],
  defaultStroke = "#64748b",
  accentStroke = "#3b82f6",
) {
  const [nodes, setNodes] = useState<RFNode[]>([]);
  const [edges, setEdges] = useState<RFEdge[]>([]);
  const [settledTopoKey, setSettledTopoKey] = useState("");
  const [errorTopoKey, setErrorTopoKey] = useState<string | null>(null);
  const latestTopology = useRef({ dgNodes, dgEdges });

  useEffect(() => {
    latestTopology.current = { dgNodes, dgEdges };
  }, [dgNodes, dgEdges]);

  const topoKey = useMemo(
    () => topologyKey(dgNodes, dgEdges),
    [dgNodes, dgEdges],
  );

  const layoutBusy =
    dgNodes.length > 0 &&
    topoKey !== settledTopoKey &&
    errorTopoKey !== topoKey;
  const layoutError =
    errorTopoKey === topoKey ? "Layout computation failed" : null;

  // Full ELK layout — only when topology (node/edge set) changes
  useEffect(() => {
    const { dgNodes: layoutNodes, dgEdges: layoutEdges } =
      latestTopology.current;
    if (layoutNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      setSettledTopoKey(topoKey);
      setErrorTopoKey(null);
      return;
    }
    let cancelled = false;

    const rfNodes = toReactFlowNodes(layoutNodes, layoutEdges);
    const rfEdges = toReactFlowEdges(
      layoutEdges,
      layoutNodes,
      defaultStroke,
      accentStroke,
    );

    computeLayout(rfNodes, rfEdges)
      .then((layout) => {
        if (!cancelled) {
          setNodes(layout.nodes);
          setEdges(layout.edges);
          setErrorTopoKey(null);
          setSettledTopoKey(topoKey);
        }
      })
      .catch((err) => {
        console.error("Layout computation failed:", err);
        if (!cancelled) {
          setErrorTopoKey(topoKey);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [topoKey, defaultStroke, accentStroke]);

  // Lightweight update — apply status/style changes without relayout
  useEffect(() => {
    if (dgNodes.length === 0 || topoKey !== settledTopoKey) return;

    const rfEdges = toReactFlowEdges(
      dgEdges,
      dgNodes,
      defaultStroke,
      accentStroke,
    );
    const rfEdgeMap = new Map(rfEdges.map((e) => [e.id, e]));
    setEdges((prev) =>
      prev.map((e) => {
        const updated = rfEdgeMap.get(e.id);
        return updated
          ? { ...e, data: { ...e.data, ...updated.data }, style: updated.style }
          : e;
      }),
    );

    const rfNodes = toReactFlowNodes(dgNodes, dgEdges);
    const rfNodeMap = new Map(rfNodes.map((n) => [n.id, n]));
    setNodes((prev) =>
      prev.map((n) => {
        const updated = rfNodeMap.get(n.id);
        return updated ? { ...n, data: { ...n.data, ...updated.data } } : n;
      }),
    );
  }, [dgNodes, dgEdges, defaultStroke, accentStroke, topoKey, settledTopoKey]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    layoutBusy,
    layoutError,
  };
}
