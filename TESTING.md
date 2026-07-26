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
