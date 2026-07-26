# @upstand/server (`apps/server`)

The **Upstand Control Plane Server** is the primary backend HTTP server and worker runtime for the Upstand platform. It is built with [Hono](https://hono.dev), Bun, [tRPC](https://trpc.io), and [@circulo-ai/di](https://github.com/circulo-ai/di).

## Capabilities & Subsystems

- **Hono REST & tRPC Engine**: Ultra-fast HTTP routing with full type safety over tRPC.
- **Model Context Protocol (MCP) Server**: Implements MCP JSON-RPC 2.0 protocol handlers at `/api/mcp` and `/api/mcp/sse`.
- **UpGal AI Operator**: Server-side AI assistant engine powered by Vercel AI SDK `ToolLoopAgent`.
- **SCIM 2.0 Provisioning API**: Directory synchronization endpoints at `/api/scim/v2.0/*`.
- **Better Auth Endpoints**: Authentication and session validation handlers at `/api/auth/*`.
- **Background Workers**: Integrated runners for deployment queuing, database S3 backups, cron tasks, and alert notifications.
- **Administrative CLI**: Built-in CLI tool (`bun apps/server/dist/cli.mjs`) for emergency 2FA resets (`reset-2fa`).

## Directory Layout

```text
src/
├── cli.ts                   # Administrative CLI commands (reset-2fa, maintenance)
├── di.ts                    # Circulo DI container wiring usecases, repositories & services
├── index.ts                 # HTTP server entrypoint
├── server.ts                # App instance bootstrap & route registration
└── http/
    ├── middleware.ts        # CORS, rate limiting, and evlog logger middleware
    ├── rate-limit.ts        # Protocol rate limiting middleware
    ├── routes/
    │   ├── ai.ts            # MCP Server & UpGal AI endpoints
    │   ├── auth.ts          # Better Auth routes
    │   ├── scim.ts          # SCIM 2.0 directory sync
    │   ├── webhooks.ts      # Git push/tag webhook listeners
    │   └── ...              # System, monitoring, and terminal routes
    └── types.ts             # Hono app environment types
```

## Running & Building

```bash
# Start development server with hot reloading
bun run dev

# Check TypeScript types
bun run check-types

# Compile production bundle
bun run build

# Run administrative CLI inside container
docker exec -it <container-id> bun apps/server/dist/cli.mjs reset-2fa
```
