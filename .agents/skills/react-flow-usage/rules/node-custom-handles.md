---
title: Use Unique IDs for Multiple Handles
impact: HIGH
impactDescription: Without unique handle IDs, React Flow can't distinguish between handles, breaking multi-handle connections
tags: react-flow, nodes, handles, connections
---

## Use Unique IDs for Multiple Handles

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

**Dynamic Handle Generation:**

```tsx
const DynamicHandleNode = memo(({ data }: NodeProps) => {
  const inputs = data.inputs || [];
  const outputs = data.outputs || [];

  return (
    <div className="node">
      {inputs.map((input, index) => (
        <Handle
          key={input.id}
          type="target"
          position={Position.Left}
          id={`input-${input.id}`}  // Unique ID per input
          style={{ top: `${((index + 1) / (inputs.length + 1)) * 100}%` }}
        />
      ))}

      <div>{data.label}</div>

      {outputs.map((output, index) => (
        <Handle
          key={output.id}
          type="source"
          position={Position.Right}
          id={`output-${output.id}`}  // Unique ID per output
          style={{ top: `${((index + 1) / (outputs.length + 1)) * 100}%` }}
        />
      ))}
    </div>
  );
});
```

**Additional Context:**

- Handle IDs must be unique within the same node
- Handle IDs are referenced in edge's `sourceHandle` and `targetHandle` properties
- Without IDs, all handles of the same type are treated as one
- Use descriptive IDs like `'data-input'`, `'control-output'` for clarity

**Reference:** [Handles Documentation](https://reactflow.dev/learn/customization/handles)
