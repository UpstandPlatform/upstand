---
title: Use Dagre for Automatic Hierarchical Layout
impact: MEDIUM
impactDescription: Manual positioning is tedious and error-prone; dagre provides automatic, consistent layouts
tags: react-flow, layout, dagre, positioning
---

## Use Dagre for Automatic Hierarchical Layout

Use the `dagre` library to automatically layout nodes in hierarchical graphs, saving manual positioning and ensuring consistent spacing.

**Manual positioning (tedious and inconsistent):**

```tsx
// ❌ Manually calculating positions - hard to maintain
const nodes = [
  { id: '1', position: { x: 250, y: 0 }, data: { label: 'Root' } },
  { id: '2', position: { x: 100, y: 100 }, data: { label: 'Child 1' } },
  { id: '3', position: { x: 400, y: 100 }, data: { label: 'Child 2' } },
  // Hard to keep aligned, spaced, and organized
];
```

**Automatic layout with dagre:**

```tsx
import dagre from 'dagre';
import { Node, Edge } from '@xyflow/react';

const getLayoutedElements = (
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB'
) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  // Set layout direction: TB (top-bottom) or LR (left-right)
  dagreGraph.setGraph({ rankdir: direction });

  // Add nodes to dagre graph
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 172, height: 36 });
  });

  // Add edges to dagre graph
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Calculate layout
  dagre.layout(dagreGraph);

  // Apply calculated positions to nodes
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 172 / 2,
        y: nodeWithPosition.y - 36 / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

// Usage in component
function Flow() {
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);

  const onLayout = useCallback((direction: 'TB' | 'LR') => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges,
      direction
    );

    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [nodes, edges]);

  return (
    <>
      <button onClick={() => onLayout('TB')}>Vertical Layout</button>
      <button onClick={() => onLayout('LR')}>Horizontal Layout</button>
      <ReactFlow nodes={nodes} edges={edges} />
    </>
  );
}
```

**Custom node sizes:**

```tsx
// Calculate node dimensions dynamically
const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 100 });

  nodes.forEach((node) => {
    // Use actual node dimensions or calculate based on content
    const width = node.width || 172;
    const height = node.height || 36;
    dagreGraph.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  return {
    nodes: nodes.map((node) => {
      const positioned = dagreGraph.node(node.id);
      return {
        ...node,
        position: {
          x: positioned.x - (node.width || 172) / 2,
          y: positioned.y - (node.height || 36) / 2,
        },
      };
    }),
    edges,
  };
};
```

**Installation:**

```bash
npm install dagre
npm install --save-dev @types/dagre
```

**Dagre Configuration Options:**

```tsx
dagreGraph.setGraph({
  rankdir: 'TB',     // TB, BT, LR, RL
  align: 'UL',       // Alignment: UL, UR, DL, DR
  nodesep: 50,       // Horizontal space between nodes
  ranksep: 100,      // Vertical space between ranks
  marginx: 20,       // Margin on x-axis
  marginy: 20,       // Margin on y-axis
});
```

**Additional Context:**

- Dagre is ideal for hierarchical/tree structures
- For force-directed layouts, consider using d3-force
- For more complex layouts, consider elkjs
- Layout calculation can be expensive for large graphs (>1000 nodes)
- Consider debouncing layout recalculation on edge changes

**Alternative: ELK (Eclipse Layout Kernel):**

For more advanced layouts, consider using elkjs which supports multiple layout algorithms.

**Reference:** [Dagre Layout Example](https://reactflow.dev/examples/layout/dagre)
