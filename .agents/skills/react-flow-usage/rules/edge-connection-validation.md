---
title: Validate Connections to Prevent Invalid Graphs
impact: HIGH
impactDescription: Without validation, users can create invalid connections (cycles, self-loops, wrong types) that break application logic
tags: react-flow, edges, validation, connections
---

## Validate Connections to Prevent Invalid Graphs

Use the `isValidConnection` prop to validate connections before they're created, preventing invalid graph structures like cycles, self-connections, or incompatible types.

**Incorrect (no validation):**

```tsx
<ReactFlow
  nodes={nodes}
  edges={edges}
  onConnect={onConnect}
  // ❌ No validation - users can create any connection
/>
// Users can create cycles, self-loops, duplicate connections
```

**Correct (prevent self-connections):**

```tsx
import { useCallback } from 'react';
import { ReactFlow, Connection } from '@xyflow/react';

function Flow() {
  const isValidConnection = useCallback((connection: Connection) => {
    // ✅ Prevent nodes from connecting to themselves
    return connection.source !== connection.target;
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
    />
  );
}
```

**Prevent Cycles (Directed Acyclic Graph):**

```tsx
import { useCallback } from 'react';
import { ReactFlow, useReactFlow, getOutgoers } from '@xyflow/react';

function Flow() {
  const { getNode, getNodes, getEdges } = useReactFlow();

  const isValidConnection = useCallback(
    (connection: Connection) => {
      // Prevent self-connections
      if (connection.source === connection.target) return false;

      // Check for cycles
      const hasCycle = (nodeId: string, visited = new Set<string>()): boolean => {
        if (visited.has(nodeId)) return true;
        visited.add(nodeId);

        const node = getNode(nodeId);
        if (!node) return false;

        const outgoers = getOutgoers(node, getNodes(), getEdges());
        return outgoers.some((outgoer) => hasCycle(outgoer.id, new Set(visited)));
      };

      return !hasCycle(connection.target);
    },
    [getNode, getNodes, getEdges]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
    />
  );
}
```

**Validate Based on Handle Types:**

```tsx
const isValidConnection = useCallback(
  (connection: Connection) => {
    const sourceNode = getNode(connection.source);
    const targetNode = getNode(connection.target);

    if (!sourceNode || !targetNode) return false;

    // Check handle compatibility
    const sourceHandle = connection.sourceHandle;
    const targetHandle = connection.targetHandle;

    // Example: Only allow data outputs to connect to data inputs
    if (sourceHandle?.startsWith('data-') && !targetHandle?.startsWith('data-')) {
      return false;
    }

    return true;
  },
  [getNode]
);
```

**Prevent Duplicate Connections:**

```tsx
const isValidConnection = useCallback(
  (connection: Connection) => {
    const edges = getEdges();

    // Check if connection already exists
    const isDuplicate = edges.some(
      (edge) =>
        edge.source === connection.source &&
        edge.target === connection.target &&
        edge.sourceHandle === connection.sourceHandle &&
        edge.targetHandle === connection.targetHandle
    );

    return !isDuplicate;
  },
  [getEdges]
);
```

**Additional Context:**

- `isValidConnection` is called before a connection is created
- Return `true` to allow the connection, `false` to reject it
- Wrap in `useCallback` to avoid re-creating the function on every render
- Common validations: cycles, self-loops, duplicates, type compatibility, max connections
- Provide visual feedback (change cursor, show tooltip) when connection is invalid

**Reference:** [Connection Validation](https://reactflow.dev/examples/interaction/validation)
