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

# Run first-party deployment fixture and pipeline tests
bun run test --filter=@upstand/infrastructure
```

## First-party deployment fixture pipelines

`fixtures/deploy` is first-party Upstand source code used to exercise
our deployment behavior. The historical directory name does not make these
fixtures an upstream compatibility suite. Extend and modify them to cover
Upstand features, including `upstand.json` project configuration, rather than
pinning them to an external repository or commit.

Deployment fixture tests must use the real Upstand composition and pipeline
boundaries. A complete scenario should create a project, create an environment,
configure application and database resources, build and deploy through the
actual use-case/API, queue/outbox, scheduler, repository, and infrastructure
flow, and verify the resulting database state, deployment history, logs,
resource transitions, generated configuration, and mocked remote-server state.

Mock external boundaries such as Docker/Swarm, SSH, Git, registries, S3, DNS,
email, and third-party HTTP services behind the same interfaces used in
production. Do not mock the pipeline, use cases, routers, repositories,
schedulers, or queue processing being tested. Do not limit coverage to private
service methods or expected command arrays.

The scenario matrix must cover self-hosted and cloud modes, multiple mocked
remote servers, application and database storage, relevant configuration
variants, authorization/organization behavior, and real `upstand.json` input.
Real Docker or cloud smoke tests can remain opt-in, but they do not replace the
deterministic mocked end-to-end suite required in CI.

The E2E tests skip safely when the API is not available. To enable authenticated
resource checks, provide `E2E_AUTH_COOKIE` and `E2E_RESOURCE_ID`. To enable
organization/deployment checks, also provide `E2E_ORGANIZATION_ID`. Mutating
checks require the explicit opt-in `E2E_ALLOW_MUTATIONS=1`.

## Local parity stack

The containerized local stack uses the same attachable Docker overlay network
and health-gated service dependencies as the self-hosted deployment path. This
lets topology, Docker discovery, and service-to-service URLs be exercised in
the same shape before deployment.

The full Compose commands enable the `edge` profile. OpenResty binds host
ports `80/443`, exposes its token-protected management API to the control plane
on port `8090`, and forwards legacy domain mappings to Caddy. If those host
ports are occupied, stop the conflicting service or run the host-process
workflow instead; do not expose Caddy's backend ports publicly.

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

To start only PostgreSQL and Redis for host-process development, use
`bun run db:start`; the edge profile is intentionally not started by that
command.

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

Production builds and the default web development server use Turbopack. The
explicit `bun run --cwd apps/web dev:webpack` fallback is available when the
current Next.js Turbopack dev server exhibits its known nested dynamic-route
404 regression in a Docker/Bun workspace. Source changes under `apps/` and
`packages/` are watched by the host workflow and by the bind-mounted Compose
workflow; the latter enables polling for Docker Desktop file-system events.

For a safe Docker cleanup, use `bun run docker:cleanup`. It removes stopped
Upstand platform containers, dangling images, and old build cache while keeping
the external overlay network and named data volumes intact.
