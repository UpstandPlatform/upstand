import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { Position } from "@xyflow/react";
import type { SimulationNodeDatum } from "d3-force";
import {
  forceCollide,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";
import ELK from "elkjs/lib/elk.bundled.js";

export type LayoutAlgorithm = "dagre" | "elk";
export type LayoutDirection = "vertical" | "horizontal";

const DEFAULT_NODE_WIDTH = 240;
const DEFAULT_NODE_HEIGHT = 120;

interface CollisionNode extends SimulationNodeDatum {
  id: string;
  targetX: number;
  targetY: number;
  width: number;
  height: number;
  radius: number;
}

/**
 * Apply Dagre hierarchical layout strategy
 */
export function getDagreLayout<T extends Node = Node>(
  nodes: T[],
  edges: Edge[],
  direction: LayoutDirection = "vertical",
): { nodes: T[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  const isHorizontal = direction === "horizontal";
  const dagreDirection = isHorizontal ? "LR" : "TB";

  dagreGraph.setGraph({
    rankdir: dagreDirection,
    ranksep: 90,
    nodesep: 60,
    marginx: 40,
    marginy: 40,
  });

  nodes.forEach((node) => {
    const width = node.measured?.width || node.width || DEFAULT_NODE_WIDTH;
    const height = node.measured?.height || node.height || DEFAULT_NODE_HEIGHT;
    dagreGraph.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const width = node.measured?.width || node.width || DEFAULT_NODE_WIDTH;
    const height = node.measured?.height || node.height || DEFAULT_NODE_HEIGHT;

    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

/**
 * Apply ELK.js layered layout strategy
 */
export async function getElkLayout<T extends Node = Node>(
  nodes: T[],
  edges: Edge[],
  direction: LayoutDirection = "vertical",
): Promise<{ nodes: T[]; edges: Edge[] }> {
  const elk = new ELK();
  const isHorizontal = direction === "horizontal";
  const elkDirection = isHorizontal ? "RIGHT" : "DOWN";

  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": elkDirection,
      "elk.spacing.nodeNode": "70",
      "elk.layered.spacing.nodeNodeBetweenLayers": "100",
      "elk.padding": "[top=50,left=50,bottom=50,right=50]",
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: node.measured?.width || node.width || DEFAULT_NODE_WIDTH,
      height: node.measured?.height || node.height || DEFAULT_NODE_HEIGHT,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const layoutedGraph = await elk.layout(graph);

  const layoutedNodes = nodes.map((node) => {
    const elkNode = layoutedGraph.children?.find((n) => n.id === node.id);
    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: elkNode?.x ?? node.position.x,
        y: elkNode?.y ?? node.position.y,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

/**
 * Node collision avoidance using d3-force simulation
 */
export function resolveNodeCollisions<T extends Node = Node>(
  nodes: T[],
  padding = 30,
): T[] {
  if (nodes.length <= 1) return nodes;

  const simNodes: CollisionNode[] = nodes.map((node) => {
    const width = node.measured?.width || node.width || DEFAULT_NODE_WIDTH;
    const height = node.measured?.height || node.height || DEFAULT_NODE_HEIGHT;
    const radius = Math.sqrt(width * width + height * height) / 2 + padding;

    return {
      id: node.id,
      x: node.position.x + width / 2,
      y: node.position.y + height / 2,
      targetX: node.position.x + width / 2,
      targetY: node.position.y + height / 2,
      width,
      height,
      radius,
    };
  });

  const simulation = forceSimulation<CollisionNode>(simNodes)
    .force("charge", forceManyBody().strength(-100))
    .force(
      "collide",
      forceCollide<CollisionNode>((d) => d.radius).iterations(4),
    )
    .force("x", forceX<CollisionNode>((d) => d.targetX).strength(0.3))
    .force("y", forceY<CollisionNode>((d) => d.targetY).strength(0.3))
    .stop();

  for (let i = 0; i < 120; ++i) {
    simulation.tick();
  }

  return nodes.map((node) => {
    const simNode = simNodes.find((n) => n.id === node.id);
    if (!simNode) return node;

    const width = node.measured?.width || node.width || DEFAULT_NODE_WIDTH;
    const height = node.measured?.height || node.height || DEFAULT_NODE_HEIGHT;

    return {
      ...node,
      position: {
        x: Math.round((simNode.x ?? node.position.x) - width / 2),
        y: Math.round((simNode.y ?? node.position.y) - height / 2),
      },
    };
  });
}
