import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  type Node as RFNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Input } from "@upstand/ui/components/input";
import { useCallback, useMemo } from "react";
import { RefreshCw, Search } from "@/components/huge-icons";
import { useDetailPanel } from "../hooks/use-detail-panel";
import { useGraphLayout } from "../hooks/use-graph-layout";
import { useSearchFilter } from "../hooks/use-search-filter";
import { useSelectionHighlight } from "../hooks/use-selection-highlight";
import type { DGEdge, DGNode } from "../types";
import { networkColor } from "../utils/colors";
import { ContainerNode } from "./container-node";
import { ElkEdge } from "./elk-edge";
import { NetworkGroup } from "./network-group";
import { OverviewCards } from "./overview-cards";
import { ServerNode } from "./server-node";
import { TableView } from "./table-view";
import { TopologyDetailPanel } from "./topology-detail-panel";
import { VolumeNode } from "./volume-node";

const nodeTypes = {
  containerNode: ContainerNode,
  serverNode: ServerNode,
  networkGroup: NetworkGroup,
  volumeNode: VolumeNode,
};

const edgeTypes = {
  elk: ElkEdge,
};

export interface FlowCanvasProps {
  dgNodes: DGNode[];
  dgEdges: DGEdge[];
  isLoading?: boolean;
  activeView?: "graph" | "table" | "overview";
}

export function FlowCanvas({
  dgNodes,
  dgEdges,
  isLoading,
  activeView = "graph",
}: FlowCanvasProps) {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    layoutBusy,
    layoutError,
  } = useGraphLayout(dgNodes, dgEdges);

  const searchFilter = useSearchFilter(dgNodes);
  const { detailOpen, selectedNode, handleInfoClick, closeDetail } =
    useDetailPanel(dgNodes, dgEdges);

  const handleInfoClickWithSelect = useCallback(
    (nodeId: string) => {
      handleInfoClick(nodeId);
    },
    [handleInfoClick],
  );

  const enrichedNodes = useMemo(() => {
    return nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        onInfoClick: handleInfoClickWithSelect,
      },
    }));
  }, [nodes, handleInfoClickWithSelect]);

  const { styledNodes, styledEdges, onNodeClick, onEdgeClick, onPaneClick } =
    useSelectionHighlight(
      enrichedNodes,
      edges,
      searchFilter.matchingNodeIds,
      searchFilter.hasFilter,
    );

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Subview Content */}
      <div className="relative flex-1 overflow-hidden">
        {activeView === "overview" ? (
          <OverviewCards nodes={dgNodes} />
        ) : activeView === "table" ? (
          <TableView nodes={dgNodes} onSelectNode={handleInfoClickWithSelect} />
        ) : (
          <div className="relative h-full w-full">
            {/* Embedded Canvas Search Bar */}
            <Panel position="top-left" className="z-10 m-4">
              <div className="relative w-64 rounded-lg border border-border bg-card/90 shadow-sm backdrop-blur">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search elements..."
                  value={searchFilter.searchTerm}
                  onChange={(e) => searchFilter.setSearchTerm(e.target.value)}
                  className="h-8 border-0 bg-transparent pl-8 text-xs focus-visible:ring-1 focus-visible:ring-primary"
                />
              </div>
            </Panel>

            {(isLoading || layoutBusy) && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-xs">
                <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 font-medium text-foreground text-xs shadow-lg">
                  <RefreshCw className="size-3.5 animate-spin text-primary" />
                  <span>Computing layout...</span>
                </div>
              </div>
            )}

            {layoutError && (
              <div className="absolute top-4 right-4 z-10 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-destructive text-xs">
                Layout calculation failed: {layoutError}
              </div>
            )}

            {dgNodes.length === 0 && !isLoading && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                No active infrastructure resources detected.
              </div>
            )}

            <ReactFlow
              nodes={styledNodes}
              edges={styledEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              elevateNodesOnSelect={false}
              fitView
              minZoom={0.05}
              maxZoom={2}
              className="bg-background"
            >
              <Background
                variant={BackgroundVariant.Dots}
                color="var(--border)"
                gap={24}
                size={1}
              />
              <Panel position="bottom-left" className="m-4 flex flex-col gap-2">
                <Controls
                  showInteractive={false}
                  className="overflow-hidden rounded-lg border-border bg-card text-foreground shadow-xs"
                />
              </Panel>

              <MiniMap
                className="m-4 overflow-hidden rounded-lg border-border! bg-card! shadow-sm"
                maskColor="rgba(15, 23, 42, 0.4)"
                nodeColor={(node: RFNode) => {
                  if (node.type === "networkGroup")
                    return networkColor(
                      (node.data as { dgNode: DGNode })?.dgNode?.name ?? "",
                    );
                  if (node.type === "volumeNode") return "#f97316";
                  if (node.type === "serverNode") return "#3b82f6";
                  return "#64748b";
                }}
              />
            </ReactFlow>
          </div>
        )}

        {/* Side Detail Inspection Drawer */}
        {detailOpen && selectedNode && (
          <TopologyDetailPanel node={selectedNode} onClose={closeDetail} />
        )}
      </div>
    </div>
  );
}
