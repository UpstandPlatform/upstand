---
title: Use useNodesData Instead of useNodes for Specific Nodes
impact: MEDIUM
impactDescription: useNodes causes re-renders on any node change; useNodesData only re-renders when specified nodes change
tags: react-flow, hooks, performance, optimization
---

## Use useNodesData Instead of useNodes for Specific Nodes

When you only need data from specific nodes, use `useNodesData()` instead of `useNodes()` to avoid unnecessary re-renders.

**Incorrect (inefficient - re-renders on any node change):**

```tsx
function NodeCounter() {
  const nodes = useNodes(); // ❌ Re-renders when ANY node changes

  const selectedNode = nodes.find(n => n.selected);

  return <div>Selected: {selectedNode?.data.label}</div>;
}

// If you have 100 nodes and change one unrelated node,
// this component still re-renders unnecessarily
```

**Correct (efficient - only re-renders when specific node changes):**

```tsx
import { useNodesData } from '@xyflow/react';

function NodeDisplay({ nodeId }: { nodeId: string }) {
  // ✅ Only re-renders when this specific node's data changes
  const nodeData = useNodesData(nodeId);

  if (!nodeData) return <div>Node not found</div>;

  return <div>{nodeData.label}: {nodeData.value}</div>;
}
```

**Multiple Specific Nodes:**

```tsx
function MultiNodeDisplay({ nodeIds }: { nodeIds: string[] }) {
  // ✅ Only re-renders when these specific nodes change
  const nodesData = useNodesData(nodeIds);

  return (
    <div>
      {nodesData.map((data, index) => (
        <div key={nodeIds[index]}>
          {data?.label || 'Unknown'}
        </div>
      ))}
    </div>
  );
}
```

**When to Use Each Hook:**

```tsx
// Use useNodes when you need:
// - All nodes
// - To iterate over all nodes
// - To count total nodes
const allNodes = useNodes();
const nodeCount = allNodes.length;

// Use useNodesData when you need:
// - Specific node(s) data
// - To avoid re-renders from unrelated node changes
const nodeData = useNodesData('node-id');

// Use useReactFlow when you need:
// - Methods to manipulate nodes (getNode, setNodes, addNodes, etc.)
// - One-time reads without subscribing to changes
const { getNode, setNodes } = useReactFlow();
```

**Performance Comparison:**

```tsx
// Scenario: 500 nodes, user drags one node

// ❌ useNodes - re-renders on every position update (poor performance)
function BadComponent() {
  const nodes = useNodes();
  const myNode = nodes.find(n => n.id === 'my-node');
  return <div>{myNode?.data.label}</div>;
}

// ✅ useNodesData - only re-renders if 'my-node' changes (good performance)
function GoodComponent() {
  const nodeData = useNodesData('my-node');
  return <div>{nodeData?.label}</div>;
}
```

**Additional Context:**

- `useNodesData` returns the `data` property of nodes, not the full node object
- Returns `null` if node doesn't exist
- Can pass a single ID string or an array of IDs
- Significantly reduces re-renders in components that only need specific node data
- Similar pattern exists for edges with `useEdges` vs selective subscriptions

**Reference:** [useNodesData Hook](https://reactflow.dev/api-reference/hooks/use-nodes-data)
