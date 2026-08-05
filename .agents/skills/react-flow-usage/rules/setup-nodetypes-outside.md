---
title: Define nodeTypes and edgeTypes Outside Component
impact: CRITICAL
impactDescription: Defining types inside the component causes React Flow to re-initialize on every render, losing state and causing performance issues
tags: react-flow, setup, performance, memoization
---

## Define nodeTypes and edgeTypes Outside Component

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

  const edgeTypes = useMemo(() => ({
    custom: CustomEdge,
  }), []);

  return <ReactFlow nodes={nodes} nodeTypes={nodeTypes} edgeTypes={edgeTypes} />;
}
```

**Why This Matters:**

- React Flow uses reference equality to check if types have changed
- New object reference triggers complete re-initialization
- Custom nodes lose internal state and remount unnecessarily
- Causes significant performance degradation
- Can break animations and interactions

**Reference:** [Custom Nodes Documentation](https://reactflow.dev/learn/customization/custom-nodes)
