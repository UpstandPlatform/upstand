# @upstand/fumadocs (`apps/fumadocs`)

The **Upstand Documentation Site** is built with Next.js 16, [Fumadocs UI](https://fumadocs.dev), `fumadocs-mdx`, and TailwindCSS v4. It contains comprehensive technical guides, architecture diagrams, API specs, and operational playbooks for the Upstand platform.

## Content Structure

```text
content/docs/
├── getting-started/        # Quickstart, concepts, self-hosting, updates
├── features/               # Servers, deployments, routing, backups, upstand.json, etc.
├── operations/             # Infrastructure, SCIM, SSO, MCP server, UpGal, CLI tools
└── reference/              # Environment variables reference & troubleshooting
```

## Features

- **Embedded Mermaid Diagrams**: Visual architectural diagrams rendered dynamically via `mermaid`.
- **Full-Text Search**: Instant client-side and server-side search index built with `flexsearch`.
- **Documentation AI Assistant**: Built-in `/api/chat` route powered by Vercel AI SDK and OpenRouter for interactive docs Q&A.
- **Dynamic Open Graph Images**: Automatic social card generation for all documentation routes (`/og/docs/[...slug]`).

## Commands

```bash
# Start Fumadocs dev server on port 4000
bun run dev

# Generate MDX content types
bun run generate

# Check TypeScript types
bun run check-types

# Build production bundle
bun run build
```
