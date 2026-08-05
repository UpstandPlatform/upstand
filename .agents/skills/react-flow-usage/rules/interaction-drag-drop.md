---
title: Implement Drag and Drop for Adding Nodes
impact: MEDIUM
impactDescription: Drag and drop provides intuitive UX for node-based editors; requires correct coordinate transformation
tags: react-flow, interaction, drag-drop, nodes
---

## Implement Drag and Drop for Adding Nodes

Implement drag-and-drop to add nodes to the canvas by transforming screen coordinates to flow coordinates using `screenToFlowPosition()`.

**Incorrect (wrong coordinates - doesn't account for zoom/pan):**

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
// Node appears in wrong location when canvas is zoomed or panned!
```

**Correct (transforms screen to flow coordinates):**

```tsx
import { useCallback } from 'react';
import {
  useReactFlow,
  ReactFlow,
  useNodesState,
  useEdgesState
} from '@xyflow/react';

let id = 0;
const getId = () => `node_${id++}`;

function DragDropFlow() {
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

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
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onDrop={onDrop}
      onDragOver={onDragOver}
      fitView
    />
  );
}
```

**Draggable Sidebar Component:**

```tsx
function Sidebar() {
  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="sidebar">
      <div className="description">Drag nodes to the canvas</div>
      <div
        className="node-type"
        onDragStart={(e) => onDragStart(e, 'input')}
        draggable
      >
        Input Node
      </div>
      <div
        className="node-type"
        onDragStart={(e) => onDragStart(e, 'default')}
        draggable
      >
        Default Node
      </div>
      <div
        className="node-type"
        onDragStart={(e) => onDragStart(e, 'output')}
        draggable
      >
        Output Node
      </div>
    </aside>
  );
}
```

**With Custom Data:**

```tsx
const onDragStart = (event: React.DragEvent, nodeData: any) => {
  event.dataTransfer.setData(
    'application/reactflow',
    JSON.stringify(nodeData)
  );
  event.dataTransfer.effectAllowed = 'move';
};

const onDrop = useCallback(
  (event: React.DragEvent) => {
    event.preventDefault();

    const dataStr = event.dataTransfer.getData('application/reactflow');
    if (!dataStr) return;

    const nodeData = JSON.parse(dataStr);
    const position = screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    const newNode = {
      id: getId(),
      ...nodeData,
      position,
    };

    setNodes((nds) => nds.concat(newNode));
  },
  [screenToFlowPosition, setNodes]
);
```

**Complete Example with Provider:**

```tsx
import { ReactFlowProvider } from '@xyflow/react';

export default function App() {
  return (
    <ReactFlowProvider>
      <div className="app">
        <Sidebar />
        <DragDropFlow />
      </div>
    </ReactFlowProvider>
  );
}
// ReactFlowProvider needed for screenToFlowPosition to work
```

**Additional Context:**

- `screenToFlowPosition()` accounts for zoom level and pan position
- Always prevent default in `onDragOver` to allow drop
- Set `draggable` attribute on source elements
- Use `'application/reactflow'` as data type convention
- Can pass complex data as JSON string
- Requires `ReactFlowProvider` if using hooks outside `<ReactFlow>`

**Reference:** [Drag and Drop Example](https://reactflow.dev/examples/interaction/drag-and-drop)
