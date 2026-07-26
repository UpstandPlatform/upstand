# @upstand/web (`apps/web`)

The **Upstand Dashboard Web Client** is the modern web user interface for managing Docker Swarm infrastructure, applications, databases, routing, backups, and security. Built with Next.js 16 (App Router), React 19, TailwindCSS v4, and `@upstand/ui`.

## Features

- **Workload Management**: Unified UI for Applications, Docker Compose stacks, and Databases (PostgreSQL, MySQL, MariaDB, MongoDB, Redis, libSQL).
- **Cluster & Swarm Topology**: Interactive visual network and node topology map (`features/topology`).
- **UpGal AI Assistant**: Built-in AI assistant drawer with human-in-the-loop approval workflows for mutating operations.
- **Web SSH & Container Terminals**: Interactive CodeMirror editor, container logs viewer, and secure web SSH shell.
- **Organization & Multi-Tenancy**: Organization switching, team invitations, RBAC roles, SCIM directory management, and SSO setup.
- **Theme Support**: Native dark/light mode with CSS variables and Radix UI primitives.

## Directory Structure

```text
src/
├── app/                     # Next.js App Router pages and layouts
│   ├── (auth)/              # Login, register, 2FA, invitation acceptance
│   ├── (dashboard)/         # Main application dashboard routes
│   │   ├── workloads/       # Projects, applications, compose stacks, databases
│   │   ├── servers/         # Swarm managers, workers, build nodes
│   │   ├── routing/         # Custom domains, Caddyfile editor, SSL certs
│   │   ├── backups/         # S3 destination management & restore logs
│   │   ├── settings/        # Organization, RBAC, SSO, API keys, SCIM
│   │   └── ...
│   └── api/                 # Client API proxy routes
├── features/                # Domain-specific UI features
│   ├── topology/            # Interactive Swarm cluster map
│   ├── upgal/               # AI Assistant chat & approval drawers
│   ├── logs/                # Streaming log viewer
│   └── ...
└── lib/                     # tRPC client hooks & authentication helpers
```

## Running & Building

```bash
# Start development web server on port 3001
bun run dev

# Check TypeScript types
bun run check-types

# Build production distribution
bun run build
```
