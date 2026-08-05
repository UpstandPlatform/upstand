---
title: Use toObject() for Save/Restore
impact: HIGH
impactDescription: Proper save/restore implementation is essential for persistence, undo/redo, and sharing flows
tags: react-flow, state, persistence, save, restore
---

## Use toObject() for Save/Restore

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

// Missing viewport, zoom level, pan position
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
    console.log('Saved:', flow);
  }, [toObject]);

  // ✅ Restore complete flow state
  const onRestore = useCallback(() => {
    const flowStr = localStorage.getItem('flow');
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

**Save to Server:**

```tsx
const saveToServer = useCallback(async () => {
  const flow = toObject();

  try {
    await fetch('/api/flows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: flowId,
        data: flow,
        updatedAt: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error('Save failed:', error);
  }
}, [toObject, flowId]);

const loadFromServer = useCallback(async () => {
  try {
    const response = await fetch(`/api/flows/${flowId}`);
    const { data } = await response.json();

    setNodes(data.nodes || []);
    setEdges(data.edges || []);
    setViewport(data.viewport || { x: 0, y: 0, zoom: 1 });
  } catch (error) {
    console.error('Load failed:', error);
  }
}, [flowId, setNodes, setEdges, setViewport]);
```

**Export as JSON:**

```tsx
const exportFlow = useCallback(() => {
  const flow = toObject();
  const dataStr = JSON.stringify(flow, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });

  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'flow.json';
  link.click();

  URL.revokeObjectURL(url);
}, [toObject]);
```

**Import from JSON:**

```tsx
const importFlow = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const flow = JSON.parse(e.target?.result as string);
      setNodes(flow.nodes || []);
      setEdges(flow.edges || []);
      setViewport(flow.viewport || { x: 0, y: 0, zoom: 1 });
    } catch (error) {
      console.error('Invalid flow file:', error);
    }
  };
  reader.readAsText(file);
}, [setNodes, setEdges, setViewport]);
```

**toObject() Returns:**

```typescript
{
  nodes: Node[];        // All nodes with positions and data
  edges: Edge[];        // All edges with connections
  viewport: {           // Current viewport state
    x: number;
    y: number;
    zoom: number;
  };
}
```

**Additional Context:**

- Always save and restore viewport for consistent user experience
- Use versioning for flow format to handle schema changes
- Validate restored data before applying to prevent errors
- Consider compression for large flows
- Implement autosave for better UX

**Reference:** [Save and Restore Example](https://reactflow.dev/examples/interaction/save-and-restore)
