---
title: Define Custom Types for Nodes and Edges
impact: MEDIUM
impactDescription: Type safety prevents runtime errors and provides autocomplete for node/edge data
tags: react-flow, typescript, types, type-safety
---

## Define Custom Types for Nodes and Edges

Define custom types for your nodes and edges to get type safety and autocomplete for node data and custom properties.

**Incorrect (no type safety):**

```tsx
// ❌ No types - no autocomplete, no type checking
const CustomNode = ({ data }: any) => {
  return <div>{data.label}</div>; // Could be undefined at runtime
};

const nodes = [
  { id: '1', position: { x: 0, y: 0 }, data: { labell: 'Typo' } }, // Typo not caught!
];
```

**Correct (typed nodes and edges):**

```tsx
import { Node, Edge, NodeProps, Handle, Position } from '@xyflow/react';

// Define your custom data types
type CustomNodeData = {
  label: string;
  value: number;
  isActive: boolean;
};

type CustomEdgeData = {
  label?: string;
  animated?: boolean;
};

// Create typed node and edge types
type CustomNode = Node<CustomNodeData, 'custom'>;
type CustomEdge = Edge<CustomEdgeData, 'custom'>;

// Use in component with full type safety
const CustomNodeComponent = ({ data, selected }: NodeProps<CustomNodeData>) => {
  return (
    <div className={`node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      {/* ✅ Full autocomplete and type checking */}
      <div>{data.label}</div>
      <div>{data.value}</div>
      <div>{data.isActive ? 'Active' : 'Inactive'}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
};

// Type-safe node creation
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

**Union Types for Multiple Node Types:**

```tsx
type InputNodeData = {
  label: string;
  inputType: 'text' | 'number';
};

type OutputNodeData = {
  label: string;
  output: any;
};

type ProcessNodeData = {
  label: string;
  operation: string;
};

// Union type for all possible nodes
type AppNode =
  | Node<InputNodeData, 'input'>
  | Node<OutputNodeData, 'output'>
  | Node<ProcessNodeData, 'process'>;

type AppEdge = Edge;

// Use in hooks with generics
function Flow() {
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AppEdge>([]);

  const { getNodes, getEdges } = useReactFlow<AppNode, AppEdge>();

  return <ReactFlow<AppNode, AppEdge> nodes={nodes} edges={edges} />;
}
```

**Type Guards for Node Type Checking:**

```tsx
function isInputNode(node: AppNode): node is Node<InputNodeData, 'input'> {
  return node.type === 'input';
}

function isOutputNode(node: AppNode): node is Node<OutputNodeData, 'output'> {
  return node.type === 'output';
}

// Usage
const handleNodeClick = (event: React.MouseEvent, node: AppNode) => {
  if (isInputNode(node)) {
    // ✅ TypeScript knows node.data is InputNodeData
    console.log(node.data.inputType);
  } else if (isOutputNode(node)) {
    // ✅ TypeScript knows node.data is OutputNodeData
    console.log(node.data.output);
  }
};
```

**Extending Built-in Node Types:**

```tsx
import { Node, BuiltInNode } from '@xyflow/react';

type CustomData = {
  label: string;
  customField: number;
};

// Extend built-in node with custom data
type ExtendedNode = Node<CustomData> | BuiltInNode;

// Use in application
const nodes: ExtendedNode[] = [
  // Built-in default node
  {
    id: '1',
    type: 'default',
    position: { x: 0, y: 0 },
    data: { label: 'Built-in' },
  },
  // Custom node with extended data
  {
    id: '2',
    type: 'custom',
    position: { x: 200, y: 0 },
    data: {
      label: 'Custom',
      customField: 42,
    },
  },
];
```

**Type-safe Event Handlers:**

```tsx
import { NodeMouseHandler, EdgeMouseHandler } from '@xyflow/react';

const onNodeClick: NodeMouseHandler<AppNode> = (event, node) => {
  // ✅ node is typed as AppNode
  console.log(node.data);
};

const onEdgeClick: EdgeMouseHandler<AppEdge> = (event, edge) => {
  // ✅ edge is typed as AppEdge
  console.log(edge.data);
};

<ReactFlow
  nodes={nodes}
  edges={edges}
  onNodeClick={onNodeClick}
  onEdgeClick={onEdgeClick}
/>;
```

**Additional Context:**

- Always define custom data types for nodes and edges
- Use generic type parameters in hooks and components
- Create type guards for union types
- Export types for use across your application
- Consider using a single source of truth for types (e.g., types.ts)

**Reference:** [TypeScript Guide](https://reactflow.dev/learn/advanced-use/typescript)
