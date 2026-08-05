---
title: Import CSS Stylesheet
impact: CRITICAL
impactDescription: React Flow won't render correctly without the CSS import - nodes and controls will be invisible or unstyled
tags: react-flow, setup, css
---

## Import CSS Stylesheet

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

**Additional Context:**

The stylesheet includes essential styles for:
- Node positioning and rendering
- Edge paths and connection lines
- Controls (zoom, pan, fit view buttons)
- MiniMap visualization
- Selection boxes
- Handle hit areas

Import the stylesheet once at your app's entry point or in the component that renders ReactFlow.

**Reference:** [React Flow Installation](https://reactflow.dev/learn)
