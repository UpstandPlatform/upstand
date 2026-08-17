---
version: 1
slug: "apps-web-src-app-dashboard-projects-projects-tsx"
primary_target: "src/app/(dashboard)/projects/projects.tsx"
related_targets: ["src/components/dashboard/dashboard-page.tsx", "src/components/dashboard/page-toolbar.tsx", "src/app/(dashboard)/projects/[projectId]/project-detail.tsx"]
---

## Job and audience

Operate mode. An authenticated developer or platform operator arrives in an
organization workspace to locate or create a project that contains deployable
environments and resources.

## Outcome and proof

The first viewport should make the project collection, each project's current
footprint, and the primary create action obvious. The page may only show the
counts and lifecycle state returned by the project/environment queries. It must
not imply deployment health or availability from project metadata alone.

## Selected direction

Refine the incumbent dashboard system rather than replace it. Keep the shared
page header, neutral surfaces, blue action accent, semantic status colors,
rounded component language, and existing project actions. Improve scan order by
making project identity and footprint the visual anchor, grouping secondary
metadata, and making row-level actions quieter until needed.

## Scope and boundaries

- Production UI polish for the Projects index at the primary target.
- Preserve all mutations, query behavior, dialogs, warnings, confirmations,
  authorization boundaries, and route behavior.
- Keep business logic in hooks and event handlers; JSX should remain a
  composition layer over existing data and mutation owners.
- Do not add marketing claims, fake metrics, new product concepts, or a new
  typography/color system.

## States and ranges

Support loading, no organization, empty projects, active projects, archived
projects, search filtering, project descriptions, long names, and compact
mobile widths. Project and resource counts are variable and may be zero.

## Interaction and layout

Keep the page header and search toolbar responsive. Cards should remain easy to
scan in a grid, retain a clear link target, keep lifecycle status visible, and
preserve accessible labels/tooltips for icon actions. Prefer spacing and
hierarchy over additional nested containers. Retain existing focus, disabled,
loading, and reduced-motion behavior.

## Constraints and open decisions

Use `@upstand/ui` primitives and `DESIGN.md` tokens. No open product decision is
needed for this polish pass; the only deliberate assumption is that the
Projects index is the highest-leverage representative surface because the
dashboard root redirects there and its task is the product's project-to-
environment entry point.
