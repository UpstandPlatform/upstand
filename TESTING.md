# Testing Upstand

## Test layout

Tests live with the package or application that owns the behavior. File names
use the behavior under test, followed by `.test.ts` or `.test.tsx`. Black-box
tests live under `apps/server/src/e2e/` and use `.e2e.test.ts`.

The server E2E suite is organized into these workflows:

| File | Coverage |
| --- | --- |
| `integration-contracts.e2e.test.ts` | Health, OpenAPI, and authentication boundaries |
| `resource-lifecycle.e2e.test.ts` | Container identity, status transitions, and control validation |
| `deployment-workflows.e2e.test.ts` | Deployment history, observability, rollback, and deploy validation |
| `configuration-and-resource-types.e2e.test.ts` | Public configuration shape and resource-type behavior |
| `topology-and-operations.e2e.test.ts` | Topology graph integrity, server filtering, resource configuration, cron schedules, backups, and disposable update/cleanup flows |

Shared setup and HTTP behavior belong in
`apps/server/src/e2e/support/local-e2e-client.ts`; workflow files should only
contain assertions for their own feature area.

## Commands

```powershell
# All package tests through Turbo
bun run test

# Only server tests
bun run test --filter=server

# Only local server E2E tests
bun run test:e2e --filter=server
```

The E2E tests skip safely when the API is not available. To enable authenticated
resource checks, provide `E2E_AUTH_COOKIE` and `E2E_RESOURCE_ID`. To enable
organization/deployment checks, also provide `E2E_ORGANIZATION_ID`. Mutating
checks require the explicit opt-in `E2E_ALLOW_MUTATIONS=1`.

## Local parity stack

The containerized local stack uses the same attachable Docker overlay network
and health-gated service dependencies as the self-hosted deployment path. This
lets topology, Docker discovery, and service-to-service URLs be exercised in
the same shape before deployment.

```powershell
# Prepare the local Swarm network and dependencies
bun run setup -- --skip-install

# Start the full local stack
bun run docker:local:up

# Verify network, services, API health, dashboard, and docs
bun run local:verify

# Stop the stack when finished
bun run docker:local:down
```

`bun dev` remains the fast host-process workflow. It prepares the same Docker
network and runs PostgreSQL/Redis in containers, while the API and frontend run
directly on the host for faster iteration. `bun run local:verify` is intended
for the full Compose parity workflow.

The mode-specific development commands exercise the same `IS_CLOUD` feature
flag used by the production Swarm stack:

```powershell
# Single-tenant self-hosted behavior (default)
bun run dev:self-hosted

# Multi-tenant cloud behavior
bun run dev:cloud

# Verify a running host-process mode
$env:LOCAL_EXPECTED_MODE = "cloud"
bun run dev:verify
Remove-Item Env:LOCAL_EXPECTED_MODE
```

Production web builds use Turbopack. The web development server uses Webpack
until the deep dynamic dashboard route issue in the current Next.js Turbopack
dev server is resolved. Source changes under `apps/` and `packages/` are
watched by the host workflow and by the bind-mounted Compose workflow; the
latter enables polling for Docker Desktop file-system events.

For a safe Docker cleanup, use `bun run docker:cleanup`. It removes stopped
Upstand platform containers, dangling images, and old build cache while keeping
the external overlay network and named data volumes intact.
