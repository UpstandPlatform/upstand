# React Flow Usage Skill

**Version 1.0.0**
xyflow Team
January 2026

> Comprehensive React Flow patterns and best practices for building node-based UIs and interactive flow diagrams. Designed for AI agents and LLMs to guide the development of production-ready React Flow applications.

---

## Overview

This skill provides comprehensive guidance for building node-based interfaces with React Flow (@xyflow/react). It covers:

- Essential setup and configuration patterns
- Custom node and edge creation
- Performance optimization for large graphs
- State management and persistence
- Layout algorithms and positioning
- User interaction patterns
- TypeScript integration

## Structure

```
react-flow/
├── SKILL.md              - Quick reference with YAML frontmatter (loaded on skill trigger)
├── AGENTS.md             - Full compiled guide (comprehensive documentation)
├── README.md             - This file (overview and navigation)
├── metadata.json         - Skill metadata and references
├── all_links.md          - Complete list of scraped documentation URLs
├── rules/                - Individual rule files organized by category
│   ├── _sections.md      - Category metadata and structure
│   ├── _template.md      - Template for creating new rules
│   ├── setup-*.md        - Setup and configuration rules
│   ├── perf-*.md         - Performance optimization rules
│   ├── node-*.md         - Node patterns and customization
│   ├── edge-*.md         - Edge handling and customization
│   ├── state-*.md        - State management patterns
│   ├── hook-*.md         - React Flow hooks usage
│   ├── layout-*.md       - Layout and positioning patterns
│   ├── interaction-*.md  - User interaction patterns
│   └── typescript-*.md   - TypeScript integration patterns
└── scraped/              - Original documentation from reactflow.dev
    ├── learn-concepts/
    ├── learn-customization/
    ├── learn-advanced/
    ├── learn-tutorials/
    ├── learn-layouting/
    ├── learn-troubleshooting/
    ├── api-hooks/
    ├── api-types/
    ├── api-utils/
    ├── api-components/
    ├── examples-nodes/
    ├── examples-edges/
    ├── examples-interaction/
    ├── examples-layout/
    ├── examples-misc/
    └── ui-components/
```

## Rule Categories

Rules are organized into 9 categories by priority and focus:

### 1. Setup & Configuration (CRITICAL)
Essential patterns for initializing React Flow correctly.
- Package imports and CSS loading
- Provider setup
- Initial node/edge configuration
- nodeTypes and edgeTypes definition

### 2. Performance Optimization (CRITICAL)
Patterns to maintain performance with large graphs.
- Memoization strategies
- Component optimization
- Store access patterns
- Edge type selection for performance

### 3. Node Patterns (HIGH)
Best practices for node creation and customization.
- Custom node components
- Multiple handles
- Node interaction
- Node grouping and nesting

### 4. Edge Patterns (HIGH)
Edge creation, customization, and connection handling.
- Custom edge components
- Connection validation
- Edge labels and markers
- Dynamic edge routing

### 5. State Management (HIGH)
Managing flow state, persistence, and history.
- Save and restore flows
- Undo/redo implementation
- State synchronization
- External state integration

### 6. Hooks Usage (MEDIUM)
Proper usage of React Flow hooks.
- useReactFlow
- useNodesState / useEdgesState
- useNodesData for performance
- useHandleConnections
- useStore (advanced)

### 7. Layout & Positioning (MEDIUM)
Auto-layout and viewport management.
- Dagre integration
- ELK.js integration
- Custom layout algorithms
- fitView and viewport control

### 8. Interaction Patterns (MEDIUM)
User interaction handling.
- Drag and drop
- Context menus
- Selection handling
- Keyboard shortcuts

### 9. TypeScript Integration (MEDIUM)
Type-safe React Flow applications.
- Typed nodes and edges
- Generic hook usage
- Custom type definitions
- Type guards

## Quick Start

```tsx
import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const initialNodes = [
  { id: '1', position: { x: 0, y: 0 }, data: { label: 'Hello' } },
  { id: '2', position: { x: 100, y: 100 }, data: { label: 'World' } },
];

const initialEdges = [
  { id: 'e1-2', source: '1', target: '2' },
];

function Flow() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

## Usage for Agents

When this skill is triggered, agents should:

1. **Read SKILL.md first** - Quick reference and patterns
2. **Check relevant category rules** - Specific patterns for the task
3. **Reference scraped documentation** - Detailed API and examples when needed
4. **Consult AGENTS.md** - Comprehensive compiled guide

## Documentation Sources

All documentation scraped from official React Flow sources:

- **Official Site**: https://reactflow.dev
- **Learn Section**: 35 guides covering concepts, customization, and advanced topics
- **API Reference**: 82 detailed references for hooks, types, utilities, and components
- **Examples**: 56 interactive examples demonstrating patterns
- **UI Components**: 20 Pro template components
- **Total Coverage**: 228 documentation pages scraped

## Package Information

- **Package**: `@xyflow/react`
- **Minimum Version**: 12.0.0+
- **Install**: `npm install @xyflow/react`
- **GitHub**: https://github.com/xyflow/xyflow
- **License**: MIT

## Contributing

This skill is designed to be maintained and updated as React Flow evolves. To add new rules:

1. Use `rules/_template.md` as a starting point
2. Follow the naming convention: `{category}-{description}.md`
3. Include impact level, examples, and references
4. Regenerate AGENTS.md after adding rules

## References

1. https://reactflow.dev
2. https://reactflow.dev/learn
3. https://reactflow.dev/api-reference
4. https://reactflow.dev/examples
5. https://github.com/xyflow/xyflow
6. https://github.com/xyflow/react-flow-example-apps
# react-flow
