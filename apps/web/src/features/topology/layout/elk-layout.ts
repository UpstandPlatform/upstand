import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk.bundled";
import {
  CONTAINER_NODE_HEIGHT,
  VOLUME_NODE_HEIGHT,
} from "../utils/node-styles";

type ElkInstance = InstanceType<typeof import("elkjs/lib/elk.bundled").default>;
let elkPromise: Promise<ElkInstance> | null = null;

function getElk(): Promise<ElkInstance> {
  if (!elkPromise) {
    elkPromise = import("elkjs/lib/elk.bundled").then((m) => new m.default());
  }
  return elkPromise;
}

const MIN_NODE_WIDTH = 160;

const GROUP_OPTIONS = {
  "elk.padding": "[top=40,left=20,bottom=16,right=20]",
};

export const ELK_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.spacing.nodeNode": "25",
  "elk.spacing.edgeNode": "25",
  "elk.spacing.edgeEdge": "15",
  "elk.layered.spacing.nodeNodeBetweenLayers": "40",
  "elk.layered.spacing.edgeNodeBetweenLayers": "20",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "15",
  "elk.spacing.componentComponent": "70",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
};

interface Point {
  x: number;
  y: number;
}

function smoothUturns(points: Point[]): Point[] {
  const result = points.map((p) => ({ ...p }));
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < result.length - 3; i++) {
      const a = result[i];
      const b = result[i + 1];
      const c = result[i + 2];
      const d = result[i + 3];

      if (
        Math.abs(a.y - b.y) < 0.5 &&
        Math.abs(b.x - c.x) < 0.5 &&
        Math.abs(c.y - d.y) < 0.5
      ) {
        const abDir = Math.sign(b.x - a.x);
        const cdDir = Math.sign(d.x - c.x);
        const segmentGap = Math.abs(b.y - c.y);
        if (abDir !== 0 && cdDir !== 0 && abDir !== cdDir && segmentGap < 30) {
          if (Math.abs(a.x - d.x) < 0.5) {
            result.splice(i + 1, 2);
          } else {
            result.splice(i + 1, 2, { x: a.x, y: c.y });
          }
          changed = true;
          break;
        }
      }

      if (
        Math.abs(a.x - b.x) < 0.5 &&
        Math.abs(b.y - c.y) < 0.5 &&
        Math.abs(c.x - d.x) < 0.5
      ) {
        const abDir = Math.sign(b.y - a.y);
        const cdDir = Math.sign(d.y - c.y);
        const segmentGap = Math.abs(b.x - c.x);
        if (abDir !== 0 && cdDir !== 0 && abDir !== cdDir && segmentGap < 30) {
          if (Math.abs(a.y - d.y) < 0.5) {
            result.splice(i + 1, 2);
          } else {
            result.splice(i + 1, 2, { x: c.x, y: a.y });
          }
          changed = true;
          break;
        }
      }
    }
  }

  return result;
}

function extractEdgePaths(
  node: ElkNode,
  offsetX: number,
  offsetY: number,
  out: Map<string, string>,
): void {
  for (const edge of (node as { edges?: ElkExtendedEdge[] }).edges ?? []) {
    if (out.has(edge.id)) continue;
    const sections = edge.sections;
    if (!sections || sections.length === 0) continue;

    const points: Point[] = [];
    for (const section of sections) {
      const sp: Point = {
        x: section.startPoint.x + offsetX,
        y: section.startPoint.y + offsetY,
      };
      const prev = points[points.length - 1];
      if (
        !prev ||
        Math.abs(sp.x - prev.x) > 0.5 ||
        Math.abs(sp.y - prev.y) > 0.5
      ) {
        points.push(sp);
      }
      for (const bp of section.bendPoints ?? []) {
        points.push({ x: bp.x + offsetX, y: bp.y + offsetY });
      }
      points.push({
        x: section.endPoint.x + offsetX,
        y: section.endPoint.y + offsetY,
      });
    }

    const smoothed = smoothUturns(points);
    let d = `M ${smoothed[0].x} ${smoothed[0].y}`;
    for (let i = 1; i < smoothed.length; i++) {
      d += ` L ${smoothed[i].x} ${smoothed[i].y}`;
    }
    out.set(edge.id, d);
  }

  for (const child of node.children ?? []) {
    extractEdgePaths(
      child,
      offsetX + (child.x ?? 0),
      offsetY + (child.y ?? 0),
      out,
    );
  }
}

function findComponents(
  topIds: string[],
  edges: RFEdge[],
  childToParent: Map<string, string>,
): string[][] {
  const topIdSet = new Set(topIds);
  function topOf(id: string): string | undefined {
    return childToParent.get(id) ?? (topIdSet.has(id) ? id : undefined);
  }

  const adj = new Map<string, Set<string>>();
  for (const id of topIds) adj.set(id, new Set());

  for (const e of edges) {
    const s = topOf(e.source);
    const t = topOf(e.target);
    if (s && t && s !== t) {
      adj.get(s)?.add(t);
      adj.get(t)?.add(s);
    }
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const id of topIds) {
    if (visited.has(id)) continue;
    const component: string[] = [];
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (cur === undefined) break;
      if (visited.has(cur)) continue;
      visited.add(cur);
      component.push(cur);
      for (const neighbor of adj.get(cur) ?? []) {
        if (!visited.has(neighbor)) stack.push(neighbor);
      }
    }
    components.push(component);
  }

  return components;
}

function nodeHeight(rfNode: RFNode): number {
  return rfNode.type === "volumeNode"
    ? VOLUME_NODE_HEIGHT
    : CONTAINER_NODE_HEIGHT;
}

export async function computeLayout(
  nodes: RFNode[],
  edges: RFEdge[],
): Promise<{ nodes: RFNode[]; edges: RFEdge[] }> {
  const groups = nodes.filter((n) => n.type === "networkGroup");
  const children = nodes.filter((n) => n.parentId);
  const freeNodes = nodes.filter(
    (n) => n.type !== "networkGroup" && !n.parentId,
  );

  const childToParent = new Map<string, string>();
  for (const c of children) {
    if (c.parentId) childToParent.set(c.id, c.parentId);
  }

  const topIds = [...groups.map((g) => g.id), ...freeNodes.map((n) => n.id)];
  const components = findComponents(topIds, edges, childToParent);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const elkChildren: ElkNode[] = [];
  const rootEdges: ElkExtendedEdge[] = [];

  for (const compIds of components) {
    const compIdSet = new Set(compIds);

    for (const id of compIds) {
      const rfNode = nodeMap.get(id);
      if (!rfNode) continue;

      if (rfNode.type === "networkGroup") {
        const groupChildren = children.filter((n) => n.parentId === id);
        elkChildren.push({
          id,
          layoutOptions: GROUP_OPTIONS,
          children:
            groupChildren.length > 0
              ? groupChildren.map((child) => ({
                  id: child.id,
                  width: MIN_NODE_WIDTH,
                  height: nodeHeight(nodeMap.get(child.id) ?? child),
                  layoutOptions: { "elk.alignment": "TOP" },
                }))
              : [{ id: `${id}__placeholder`, width: 120, height: 1 }],
        });
      } else {
        elkChildren.push({
          id,
          width: MIN_NODE_WIDTH,
          height: nodeHeight(rfNode),
          layoutOptions: { "elk.alignment": "TOP" },
        });
      }
    }

    const groupEdgeMap = new Map<string, ElkExtendedEdge[]>();
    for (const e of edges) {
      const sTop = childToParent.get(e.source) ?? e.source;
      const tTop = childToParent.get(e.target) ?? e.target;
      if (!compIdSet.has(sTop) || !compIdSet.has(tTop)) continue;

      const elkEdge: ElkExtendedEdge = {
        id: e.id,
        sources: [e.source],
        targets: [e.target],
      };
      const sGroup = childToParent.get(e.source);
      const tGroup = childToParent.get(e.target);
      if (sGroup && tGroup && sGroup === tGroup) {
        const list = groupEdgeMap.get(sGroup) ?? [];
        list.push(elkEdge);
        groupEdgeMap.set(sGroup, list);
      } else {
        rootEdges.push(elkEdge);
      }
    }

    for (const elkChild of elkChildren) {
      const groupEdges = groupEdgeMap.get(elkChild.id);
      if (groupEdges) {
        (elkChild as ElkNode & { edges: ElkExtendedEdge[] }).edges = groupEdges;
      }
    }
  }

  const wrappedChildren: ElkNode[] = [];
  const wrappedEdges: ElkExtendedEdge[] = [];

  for (const compIds of components) {
    const compIdSet = new Set(compIds);
    const compChildren = elkChildren.filter((c) => compIdSet.has(c.id));
    const compEdges = rootEdges.filter((e) => {
      const s = childToParent.get(e.sources[0]) ?? e.sources[0];
      const t = childToParent.get(e.targets[0]) ?? e.targets[0];
      return compIdSet.has(s) && compIdSet.has(t);
    });

    if (compChildren.length === 1 && compEdges.length === 0) {
      wrappedChildren.push(compChildren[0]);
    } else {
      wrappedChildren.push({
        id: `__comp_${compIds[0]}`,
        layoutOptions: {
          ...ELK_OPTIONS,
          "elk.hierarchyHandling": "INCLUDE_CHILDREN",
          "elk.padding": "[top=0,left=0,bottom=0,right=0]",
        },
        children: compChildren,
        edges: compEdges,
      });
    }
  }

  const elkGraph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.separateConnectedComponents": "true",
      "elk.spacing.nodeNode": "40",
      "elk.aspectRatio": "1.4",
      "elk.padding": "[top=0,left=0,bottom=0,right=0]",
    },
    children: wrappedChildren,
    edges: wrappedEdges,
  };

  const elk = await getElk();
  const layout = await elk.layout(elkGraph);

  for (const topNode of layout.children ?? []) {
    const isWrapper = topNode.id.startsWith("__comp_");
    const offsetX = isWrapper ? (topNode.x ?? 0) : 0;
    const offsetY = isWrapper ? (topNode.y ?? 0) : 0;
    const elkNodes = isWrapper ? (topNode.children ?? []) : [topNode];

    for (const elkNode of elkNodes) {
      const rfNode = nodeMap.get(elkNode.id);
      if (!rfNode) continue;
      rfNode.position = {
        x: (elkNode.x ?? 0) + offsetX,
        y: (elkNode.y ?? 0) + offsetY,
      };
      if (rfNode.type === "networkGroup") {
        rfNode.style = {
          ...rfNode.style,
          width: elkNode.width,
          height: elkNode.height,
        };
      }
      for (const elkChild of elkNode.children ?? []) {
        const rfChild = nodeMap.get(elkChild.id);
        if (rfChild) {
          rfChild.position = { x: elkChild.x ?? 0, y: elkChild.y ?? 0 };
        }
      }
    }
  }

  const edgePaths = new Map<string, string>();
  extractEdgePaths(layout, 0, 0, edgePaths);

  const updatedEdges = edges.map((e) => {
    const path = edgePaths.get(e.id);
    if (path) {
      return { ...e, type: "elk", data: { ...(e.data ?? {}), path } };
    }
    return e;
  });

  const allNodes = [...groups, ...children, ...freeNodes];
  return { nodes: allNodes, edges: updatedEdges };
}
