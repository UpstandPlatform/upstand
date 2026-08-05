---
title: Memoize Custom Node and Edge Components
impact: CRITICAL
impactDescription: Un-memoized components re-render on every graph update, causing severe performance issues with large graphs
tags: react-flow, performance, memoization, nodes, edges
---

## Memoize Custom Node and Edge Components

Always wrap custom node and edge components with `React.memo()` to prevent unnecessary re-renders when other parts of the graph change.

**Incorrect (no memoization):**

```tsx
// ❌ Re-renders on every graph update (any node/edge change)
function CustomNode({ data, selected }) {
  return (
    <div className={`node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div>{data.label}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

// With 100 nodes, a single node update triggers 100 re-renders!
```

**Correct (memoized):**

```tsx
import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';

// ✅ Only re-renders when this specific node's props change
const CustomNode = memo(({ data, selected }: NodeProps) => {
  return (
    <div className={`node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div>{data.label}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

CustomNode.displayName = 'CustomNode'; // Helpful for debugging
```

**For Custom Edges:**

```tsx
import { memo } from 'react';
import { BaseEdge, getBezierPath, EdgeProps } from '@xyflow/react';

const CustomEdge = memo(({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps) => {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return <BaseEdge path={edgePath} />;
});

CustomEdge.displayName = 'CustomEdge';
```

**Performance Impact:**

Without memoization:
- 100 nodes × 1 update = 100 re-renders
- 500 nodes × 1 update = 500 re-renders
- Causes lag, dropped frames, and poor UX

With memoization:
- Only the changed node re-renders
- Smooth interactions even with large graphs

**Additional Tips:**

- Use `React.memo()` for all custom components (nodes, edges, connection lines)
- Ensure props are stable (avoid inline objects/functions in parent)
- Combine with proper memoization of callbacks and event handlers

**Reference:** [Performance Best Practices](https://reactflow.dev/learn/advanced-use/performance)
