---
name: Upstand Dashboard
description: A restrained operational console for projects, environments, resources, and infrastructure.
colors:
  primary: "oklch(0.488 0.243 264.376)"
  primary-foreground: "oklch(0.97 0.014 254.604)"
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  card: "oklch(1 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  border: "oklch(0.922 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  success: "oklch(0.6 0.16 150)"
  warning: "oklch(0.72 0.16 80)"
  info: "oklch(0.58 0.18 245)"
typography:
  body:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
  label:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.25
rounded:
  base: "0.625rem"
  input: "1.375rem"
  button: "1.625rem"
  card: "1.625rem"
spacing:
  page-inline: "1rem"
  page-block: "1.5rem"
  card: "1rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.button}"
    height: "2.25rem"
  input:
    backgroundColor: "color-mix(in oklch, {colors.background}, {colors.foreground} 5%)"
    textColor: "{colors.foreground}"
    rounded: "{rounded.input}"
    height: "2.25rem"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "1rem"
---

# Design System: Upstand Dashboard

## Overview

**Current system thesis: "Operational Clarity" (observed from the incumbent implementation).**

The dashboard is a dense but approachable operations console. It uses shared
React primitives, a neutral surface system, a single blue action accent, and
small status colors to keep infrastructure state scannable. The design should
feel dependable and deliberate rather than promotional.

The system is currently component-led: layout, buttons, cards, inputs, tabs,
dialogs, tooltips, and sidebar navigation are owned by `@upstand/ui` and
composed by feature surfaces. Preserve that ownership when polishing a page.

**Key Characteristics:**

- Neutral surfaces with blue reserved for primary actions and focus.
- Strong title/label hierarchy with compact operational metadata.
- Rounded controls and cards with soft utility depth.
- Responsive, theme-aware compositions with reduced-motion support.

## Colors

The palette is neutral-first, with a saturated blue primary and semantic green,
amber, red, and informational accents. The `.dark` theme provides separate
semantic values and must remain intact.

### Primary

- **Action Blue** (`{colors.primary}`): primary actions, links, selected states,
  and product identity accents.
- **Action Blue Foreground** (`{colors.primary-foreground}`): text and icons on
  primary surfaces.

### Neutral

- **Canvas** (`{colors.background}`): page background in the light theme.
- **Ink** (`{colors.foreground}`): primary text and important values.
- **Card** (`{colors.card}`): raised content surfaces.
- **Muted Surface** (`{colors.muted}`): quiet controls, hover surfaces, and
  secondary grouping.
- **Muted Ink** (`{colors.muted-foreground}`): supporting text and metadata.
- **Border** (`{colors.border}`): separators and low-emphasis outlines.

### Semantic

- **Success** (`{colors.success}`): healthy or completed state.
- **Warning** (`{colors.warning}`): caution and blocked/precondition states.
- **Destructive** (`{colors.destructive}`): irreversible or dangerous actions.
- **Info** (`{colors.info}`): informational state and guidance.

**The Accent-Rarity Rule.** Keep the primary accent for actions, active state,
and meaningful emphasis; do not turn every metadata label into an accent.

## Typography

**Display Font:** system sans stack (`ui-sans-serif`, `-apple-system`,
`BlinkMacSystemFont`, `Segoe UI`)

**Body Font:** the same system sans stack

**Label/Mono Font:** the existing system monospace stack for code, logs, and
measurement values only.

**Character:** compact, legible, and operational. Weight and size carry
hierarchy; decoration should not compete with state or action.

### Hierarchy

- **Title** (700, `1.5rem`, `1.25`): page and environment headings.
- **Component title** (500–600, `1rem`): card and section titles.
- **Body** (400, `0.875rem`, `1.5`): explanations and normal content.
- **Label** (500, `0.75rem`, `1.25`): metadata, field labels, and compact status
  descriptions.

## Layout

Dashboard pages use a centered, full-width content column capped at `max-w-7xl`
with responsive horizontal padding. Page headers separate title/description
from actions and collapse into a vertical stack on narrow screens. Grids use
one column on small screens and add columns at `sm`/`lg` breakpoints as content
allows.

The shared dashboard shell owns the sidebar, breadcrumb header, global search,
theme toggle, and scroll container. Feature pages should not recreate that
chrome. Within a surface, give the title more separation above than below and
keep related metadata in compact groups.

## Elevation & Depth

The system uses tonal layering and soft utility shadows. Cards use a raised
surface with a subtle ring/shadow; inputs and flat regions rely on contrast and
borders. Avoid stacking borders and shadows when one clear surface treatment is
enough.

## Shapes

The incumbent language is generously rounded: the base radius token is
`0.625rem`, controls use larger calculated radii, and cards use the `rounded-4xl`
variant. Preserve the existing component geometry within a surface; do not
introduce sharp corners or unrelated pill treatments.

## Components

### Buttons

- Primary buttons use the blue action surface and a compact `h-9`/`h-10` control
  height.
- Outline, secondary, ghost, link, and destructive variants are semantic and
  should use the shared `Button` component.
- Focus-visible states use a ring, and disabled states reduce opacity without
  changing layout.

### Cards / Containers

- Cards use the shared `Card` primitive, rounded-4xl geometry, a card surface,
  and soft ring/shadow depth.
- Card headers hold title/status; content holds descriptions or counts; footers
  hold metadata and row-level actions.
- Avoid nesting cards merely to group information; use spacing, separators, or
  a quieter surface when a second container is not semantically necessary.

### Inputs / Fields

- Inputs are compact, full-width controls with the shared rounded input shape,
  muted background, visible focus ring, and semantic invalid state.
- Field labels and helper text remain close to their controls; errors must name
  the problem and recovery action.

### Navigation

- The sidebar and breadcrumb header are owned by the dashboard layout.
- Active navigation uses the shared sidebar state rather than custom page-level
  indicators.

## Do's and Don'ts

### Do:

- **Do** reuse `@upstand/ui` primitives and existing semantic tokens.
- **Do** make project, environment, resource, and runtime state scannable in a
  single glance.
- **Do** preserve light/dark values, keyboard focus, and reduced-motion behavior.
- **Do** keep data fetching, mutations, and business rules in hooks/use cases;
  let JSX express composition and presentation.

### Don't:

- **Don't** invent customer proof, performance metrics, availability claims, or
  runtime status.
- **Don't** add gradients, decorative motion, or a new font without a product
  or surface-specific reason.
- **Don't** wrap every small group in another rounded card.
- **Don't** bypass shared tokens or move authorization, mutation, or destructive
  action logic into presentational components.
