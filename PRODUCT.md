# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are developers and platform operators working in an authenticated
organization workspace. They use Upstand to group deployable workloads into
projects and environments, inspect runtime state, and perform controlled
deployment and infrastructure operations.

This audience and operating context are inferred from the repository's project,
environment, resource, organization, deployment, server, and observation
routes; no separate user-research artifact was found.

## Product Purpose

Upstand is a container-first control plane for self-hosted and cloud
deployments. It gives operators one web console for managing Docker Swarm
nodes, applications, databases, Compose workloads, routing, backups, security,
and remote server operations.

For the selected Projects surface, success means an operator can quickly find
the right project, understand its environment/resource footprint, and create,
open, archive, duplicate, or safely delete a project without guessing what
will happen.

## Positioning

The product-specific mechanism established by the codebase is the
project → environment → resource model combined with control-plane orchestration
across local and remote deployment targets. No independently verified
competitive or superiority claim is established here; future design work must
not invent one.

## Operating Context

Users work inside an organization, switch between projects and environments,
and manage applications, databases, and Compose resources. Deployments and
mutating operations can involve remote Docker servers, queues, logs, approvals,
authorization checks, and audit history. The web client also exposes an UpGal
AI assistant with human-in-the-loop approvals for mutating operations.

## Capabilities and Constraints

- The primary product surface is a Next.js App Router web dashboard using React,
  Tailwind CSS v4, shared `@upstand/ui` primitives, tRPC, Better Auth, and
  organization-aware data access.
- The supported product modes are self-hosted and cloud; the UI must not imply
  a deployment target or runtime state that the API has not returned.
- Project cards expose live environment/resource counts and project lifecycle
  actions. Destructive operations must preserve their existing warnings,
  confirmations, and authorization behavior.
- Business rules and API orchestration belong outside JSX components. UI work
  should compose existing hooks, use cases, routers, and shared primitives.
- The product supports light and dark themes, responsive layouts, keyboard
  interaction, and reduced-motion handling through the existing design system.

## Brand Commitments

The product name is Upstand. Existing brand assets are under
`apps/web/public/brand/`, and the current interface uses a restrained blue
primary accent, neutral surfaces, Hugeicons, and shared shadcn-style
components. These are incumbent implementation facts, not a new visual brief.

## Evidence on Hand

- Product capabilities and architecture: `README.md`, `ARCHITECTURE.md`, and
  `apps/web/README.md`.
- Product routes and behavior: `apps/web/src/app/(dashboard)/` and
  `apps/web/src/features/`.
- Shared visual tokens and primitives: `packages/ui/src/styles/globals.css`
  and `packages/ui/src/components/`.
- Brand assets: `apps/web/public/brand/logo.svg` and `icon.svg`.

No verified testimonials, customer logos, case studies, conversion metrics,
pricing claims, or independent benchmarks were found. Future work must not
fabricate these forms of evidence.

## Product Principles

- Make operational state legible before asking for action.
- Prefer truthful, durable state over optimistic or guessed status.
- Keep destructive and security-sensitive actions explicit and recoverable
  where the product supports recovery.
- Respect organization boundaries and role-based access at every surface.
- Keep the operator's path from project to environment to resource coherent.
