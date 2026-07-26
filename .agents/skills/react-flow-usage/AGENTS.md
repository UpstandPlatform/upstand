# React Flow Usage Guide

**Version 1.0.0**
xyflow Team
January 2026

> **Note:**
> This document is designed for AI agents and LLMs to follow when building,
> maintaining, or refactoring React Flow applications. Humans may also find
> it useful, but guidance here is optimized for automation and consistency.

---

## Abstract

Comprehensive React Flow (@xyflow/react) usage guide for building production-ready node-based UIs and interactive flow diagrams. Contains best practices across 9 categories covering setup, customization, performance, layout, and advanced patterns. Each rule includes detailed explanations, real-world examples comparing incorrect vs. correct implementations, and specific guidance for building robust flow applications.

---

## Table of Contents

1. [Setup & Configuration](#1-setup--configuration) — **CRITICAL**
   - 1.1 [Import CSS Stylesheet](#11-import-css-stylesheet)
   - 1.2 [Define nodeTypes and edgeTypes Outside Component](#12-define-nodetypes-and-edgetypes-outside-component)

2. [Performance Optimization](#2-performance-optimization) — **CRITICAL**
   - 2.1 [Memoize Custom Node and Edge Components](#21-memoize-custom-node-and-edge-components)

3. [Node Patterns](#3-node-patterns) — **HIGH**
   - 3.1 [Use Unique IDs for Multiple Handles](#31-use-unique-ids-for-multiple-handles)

4. [Edge Patterns](#4-edge-patterns) — **HIGH**
   - 4.1 [Validate Connections to Prevent Invalid Graphs](#41-validate-connections-to-prevent-invalid-graphs)

5. [State Management](#5-state-management) — **HIGH**
   - 5.1 [Use toObject() for Save/Restore](#51-use-toobject-for-saverestore)

6. [Hooks Usage](#6-hooks-usage) — **MEDIUM**
   - 6.1 [Use useNodesData Instead of useNodes for Specific Nodes](#61-use-usenodes data-instead-of-usenodes-for-specific-nodes)

7. [Layout & Positioning](#7-layout--positioning) — **MEDIUM**
   - 7.1 [Use Dagre for Automatic Hierarchical Layout](#71-use-dagre-for-automatic-hierarchical-layout)

8. [Interaction Patterns](#8-interaction-patterns) — **MEDIUM**
   - 8.1 [Implement Drag and Drop for Adding Nodes](#81-implement-drag-and-drop-for-adding-nodes)

9. [TypeScript Integration](#9-typescript-integration) — **MEDIUM**
   - 9.1 [Define Custom Types for Nodes and Edges](#91-define-custom-types-for-nodes-and-edges)

---

## 1. Setup & Configuration

**Impact: CRITICAL**

Proper setup is essential for React Flow to work correctly. Missing CSS imports or incorrect type definitions will cause rendering issues and performance problems.

### 1.1 Import CSS Stylesheet

**Impact: CRITICAL (React Flow won't render correctly without the CSS import)**

Always import the React Flow stylesheet to ensure proper styling of nodes, edges, controls, and other components.

**Incorrect (missing CSS import):**

```tsx
import { ReactFlow } from '@xyflow/react';

function Flow() {
  return <ReactFlow nodes={nodes} edges={edges} />;
  // Nodes, edges, and controls will be invisible or broken
}
```

**Correct (CSS imported):**

```tsx
import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css'; // Essential!

function Flow() {
  return <ReactFlow nodes={nodes} edges={edges} />;
}
```

The stylesheet includes essential styles for node positioning, edge paths, controls, minimap, selection boxes, and handle hit areas. Import the stylesheet once at your app's entry point or in the component that renders ReactFlow.

**Reference:** https://reactflow.dev/learn

### 1.2 Define nodeTypes and edgeTypes Outside Component

**Impact: CRITICAL (Causes React Flow to re-initialize on every render, losing state)**

Always define `nodeTypes` and `edgeTypes` outside your component or memoize them with `useMemo`. Defining them inline causes React Flow to treat them as new types on every render, breaking memoization and causing performance issues.

**Incorrect (defined inside component):**

```tsx
function Flow() {
  const [nodes, setNodes] = useState([]);

  // ❌ Creates new object on every render
  const nodeTypes = {
    custom: CustomNode,
    special: SpecialNode,
  };

  return <ReactFlow nodes={nodes} nodeTypes={nodeTypes} />;
  // React Flow re-initializes, loses internal state, poor performance
}
```

**Correct (defined outside component):**

```tsx
// ✅ Stable reference, defined once
const nodeTypes = {
  custom: CustomNode,
  special: SpecialNode,
};

const edgeTypes = {
  custom: CustomEdge,
};

function Flow() {
  const [nodes, setNodes] = useState([]);

  return <ReactFlow nodes={nodes} nodeTypes={nodeTypes} edgeTypes={edgeTypes} />;
}
```

**Alternative (using useMemo):**

```tsx
function Flow() {
  const [nodes, setNodes] = useState([]);

  // ✅ Memoized, only created once
  const nodeTypes = useMemo(() => ({
    custom: CustomNode,
    special: SpecialNode,
  }), []);

  return <ReactFlow nodes={nodes} nodeTypes={nodeTypes} />;
}
```

React Flow uses reference equality to check if types have changed. New object references trigger complete re-initialization, causing custom nodes to lose internal state, breaking animations and interactions, and causing significant performance degradation.

**Reference:** https://reactflow.dev/learn/customization/custom-nodes

---

## 2. Performance Optimization

**Impact: CRITICAL**

Performance optimizations are essential for React Flow applications, especially those with large graphs (100+ nodes). Proper memoization prevents unnecessary re-renders and keeps the UI responsive.

### 2.1 Memoize Custom Node and Edge Components

**Impact: CRITICAL (Un-memoized components re-render on every graph update)**

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

const CustomEdge = memo(({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps) => {
  const [edgePath] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });

  return <BaseEdge path={edgePath} />;
});

CustomEdge.displayName = 'CustomEdge';
```

**Performance Impact:**

Without memoization, 100 nodes with 1 update = 100 re-renders. With memoization, only the changed node re-renders, ensuring smooth interactions even with large graphs.

**Reference:** https://reactflow.dev/learn/advanced-use/performance

---

## 3. Node Patterns

**Impact: HIGH**

Proper node customization enables building rich, interactive interfaces. Understanding handles and custom node patterns is essential for creating functional flow applications.

### 3.1 Use Unique IDs for Multiple Handles

**Impact: HIGH (Without unique handle IDs, React Flow can't distinguish between handles)**

When a node has multiple source or target handles, each handle must have a unique `id` prop. Without unique IDs, React Flow treats all handles as the same connection point.

**Incorrect (no handle IDs):**

```tsx
const MultiHandleNode = memo(({ data }) => (
  <div className="node">
    {/* ❌ No IDs - React Flow can't distinguish these handles */}
    <Handle type="target" position={Position.Top} />
    <Handle type="target" position={Position.Top} style={{ left: '75%' }} />
    <div>{data.label}</div>
    <Handle type="source" position={Position.Bottom} />
    <Handle type="source" position={Position.Bottom} style={{ left: '75%' }} />
  </div>
));
// All connections go to/from the first handle only!
```

**Correct (unique handle IDs):**

```tsx
import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';

const MultiHandleNode = memo(({ data }: NodeProps) => (
  <div className="node">
    {/* ✅ Unique IDs allow independent connections */}
    <Handle type="target" position={Position.Top} id="input-1" />
    <Handle type="target" position={Position.Top} id="input-2" style={{ left: '75%' }} />
    <div>{data.label}</div>
    <Handle type="source" position={Position.Bottom} id="output-1" />
    <Handle type="source" position={Position.Bottom} id="output-2" style={{ left: '75%' }} />
  </div>
));
```

**Creating Edges with Specific Handles:**

```tsx
const edges = [
  {
    id: 'e1-2',
    source: '1',
    target: '2',
    sourceHandle: 'output-1',  // Connects to specific handle
    targetHandle: 'input-2',   // Connects to specific handle
  },
];
```

Handle IDs must be unique within the same node and are referenced in edge's `sourceHandle` and `targetHandle` properties.

**Reference:** https://reactflow.dev/learn/customization/handles

---

## 4. Edge Patterns

**Impact: HIGH**

Edge customization and connection validation are critical for creating robust flow applications that prevent invalid graph structures.

### 4.1 Validate Connections to Prevent Invalid Graphs

**Impact: HIGH (Without validation, users can create invalid connections)**

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
      if (connection.source === connection.target) return false;

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

  return <ReactFlow isValidConnection={isValidConnection} />;
}
```

Common validations include preventing cycles, self-loops, duplicates, enforcing type compatibility, and limiting maximum connections.

**Reference:** https://reactflow.dev/examples/interaction/validation

---

## 5. State Management

**Impact: HIGH**

Proper state management enables persistence, undo/redo, and sharing of flows. Using React Flow's built-in methods ensures complete state capture.

### 5.1 Use toObject() for Save/Restore

**Impact: HIGH (Proper save/restore is essential for persistence)**

Use the `toObject()` method from `useReactFlow()` to serialize the complete flow state (nodes, edges, viewport) for saving and restoring.

**Incorrect (manual serialization):**

```tsx
// ❌ Manually collecting state - misses internal React Flow state
const saveFlow = () => {
  const flow = {
    nodes,
    edges,
    // Missing: viewport, internal positions, connection state
  };
  localStorage.setItem('flow', JSON.stringify(flow));
};
```

**Correct (using toObject):**

```tsx
import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';

function SaveRestore() {
  const { toObject, setNodes, setEdges, setViewport } = useReactFlow();

  // ✅ Save complete flow state
  const onSave = useCallback(() => {
    const flow = toObject();
    localStorage.setItem('flow', JSON.stringify(flow));
  }, [toObject]);

  // ✅ Restore complete flow state
  const onRestore = useCallback(() => {
    const flowStr = localStorage.setItem('flow');
    if (!flowStr) return;

    const flow = JSON.parse(flowStr);
    if (flow) {
      setNodes(flow.nodes || []);
      setEdges(flow.edges || []);
      setViewport(flow.viewport || { x: 0, y: 0, zoom: 1 });
    }
  }, [setNodes, setEdges, setViewport]);

  return (
    <>
      <button onClick={onSave}>Save</button>
      <button onClick={onRestore}>Restore</button>
    </>
  );
}
```

`toObject()` returns `{ nodes, edges, viewport }` capturing the complete flow state including zoom level and pan position.

**Reference:** https://reactflow.dev/examples/interaction/save-and-restore

---

## 6. Hooks Usage

**Impact: MEDIUM**

React Flow provides specialized hooks for efficient state access. Using the right hook for the job prevents unnecessary re-renders.

### 6.1 Use useNodesData Instead of useNodes for Specific Nodes

**Impact: MEDIUM (useNodes causes re-renders on any node change)**

When you only need data from specific nodes, use `useNodesData()` instead of `useNodes()` to avoid unnecessary re-renders.

**Incorrect (inefficient):**

```tsx
function NodeCounter() {
  const nodes = useNodes(); // ❌ Re-renders when ANY node changes

  const selectedNode = nodes.find(n => n.selected);

  return <div>Selected: {selectedNode?.data.label}</div>;
}
```

**Correct (efficient):**

```tsx
import { useNodesData } from '@xyflow/react';

function NodeDisplay({ nodeId }: { nodeId: string }) {
  // ✅ Only re-renders when this specific node's data changes
  const nodeData = useNodesData(nodeId);

  if (!nodeData) return <div>Node not found</div>;

  return <div>{nodeData.label}: {nodeData.value}</div>;
}
```

`useNodesData` significantly reduces re-renders in components that only need specific node data.

**Reference:** https://reactflow.dev/api-reference/hooks/use-nodes-data

---

## 7. Layout & Positioning

**Impact: MEDIUM**

Automatic layout algorithms eliminate manual positioning and ensure consistent, professional-looking graphs.

### 7.1 Use Dagre for Automatic Hierarchical Layout

**Impact: MEDIUM (Automatic layout saves manual positioning effort)**

Use the `dagre` library to automatically layout nodes in hierarchical graphs.

**Correct (automatic layout):**

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
  dagreGraph.setGraph({ rankdir: direction });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 172, height: 36 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

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
```

Dagre is ideal for hierarchical/tree structures. For force-directed layouts, consider d3-force, and for more complex layouts, consider elkjs.

**Reference:** https://reactflow.dev/examples/layout/dagre

---

## 8. Interaction Patterns

**Impact: MEDIUM**

Drag and drop provides intuitive UX for node-based editors and requires correct coordinate transformation.

### 8.1 Implement Drag and Drop for Adding Nodes

**Impact: MEDIUM (Drag and drop provides intuitive UX)**

Implement drag-and-drop to add nodes by transforming screen coordinates to flow coordinates using `screenToFlowPosition()`.

**Incorrect (wrong coordinates):**

```tsx
const onDrop = (event: React.DragEvent) => {
  event.preventDefault();
  const type = event.dataTransfer.getData('application/reactflow');

  // ❌ Uses screen coordinates directly - wrong when zoomed or panned
  const newNode = {
    id: getId(),
    type,
    position: { x: event.clientX, y: event.clientY },
    data: { label: `${type} node` },
  };

  setNodes((nds) => nds.concat(newNode));
};
```

**Correct (transforms coordinates):**

```tsx
import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';

function DragDropFlow() {
  const { screenToFlowPosition } = useReactFlow();

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (!type) return;

      // ✅ Transform screen coordinates to flow coordinates
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode = {
        id: getId(),
        type,
        position,
        data: { label: `${type} node` },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [screenToFlowPosition, setNodes]
  );

  return (
    <ReactFlow
      onDrop={onDrop}
      onDragOver={onDragOver}
    />
  );
}
```

`screenToFlowPosition()` accounts for zoom level and pan position, ensuring nodes appear where the user drops them.

**Reference:** https://reactflow.dev/examples/interaction/drag-and-drop

---

## 9. TypeScript Integration

**Impact: MEDIUM**

Type safety prevents runtime errors and provides excellent developer experience with autocomplete and compile-time checking.

### 9.1 Define Custom Types for Nodes and Edges

**Impact: MEDIUM (Type safety prevents runtime errors)**

Define custom types for your nodes and edges to get type safety and autocomplete.

**Incorrect (no type safety):**

```tsx
const CustomNode = ({ data }: any) => {
  return <div>{data.label}</div>; // Could be undefined at runtime
};

const nodes = [
  { id: '1', position: { x: 0, y: 0 }, data: { labell: 'Typo' } }, // Typo not caught!
];
```

**Correct (typed):**

```tsx
import { Node, NodeProps } from '@xyflow/react';

type CustomNodeData = {
  label: string;
  value: number;
  isActive: boolean;
};

type CustomNode = Node<CustomNodeData, 'custom'>;

const CustomNodeComponent = ({ data, selected }: NodeProps<CustomNodeData>) => {
  return (
    <div className={`node ${selected ? 'selected' : ''}`}>
      {/* ✅ Full autocomplete and type checking */}
      <div>{data.label}</div>
      <div>{data.value}</div>
      <div>{data.isActive ? 'Active' : 'Inactive'}</div>
    </div>
  );
};

const initialNodes: CustomNode[] = [
  {
    id: '1',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      label: 'Node 1',
      value: 42,
      isActive: true,
      // labell: 'Typo', // ✅ Type error caught at compile time!
    },
  },
];
```

Use generic type parameters in hooks and components for full type safety across your React Flow application.

**Reference:** https://reactflow.dev/learn/advanced-use/typescript

---

## References

1. https://reactflow.dev
2. https://reactflow.dev/learn
3. https://reactflow.dev/api-reference
4. https://reactflow.dev/examples
5. https://github.com/xyflow/xyflow
6. https://github.com/xyflow/react-flow-example-apps
