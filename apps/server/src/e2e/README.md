# Server E2E tests

The E2E tests are intentionally grouped by workflow so failures are easy to
locate:

- `integration-contracts.e2e.test.ts` checks public health, OpenAPI, and auth
  boundaries.
- `resource-lifecycle.e2e.test.ts` checks live container identity, state
  preservation, and lifecycle command validation.
- `deployment-workflows.e2e.test.ts` checks resource/deployment joins, runtime
  observability, and rollback/deploy validation.

The suite is safe to run without a local server: unavailable services are
skipped with a bounded timeout. Read-only resource tests require:

```powershell
$env:E2E_AUTH_COOKIE="better-auth.session_token=..."
$env:E2E_RESOURCE_ID="..."
```

Deployment and container mutation checks additionally require:

```powershell
$env:E2E_ALLOW_MUTATIONS="1"
```

Run all server tests with `bun run test --filter=server` from the repository
root, or only E2E tests with `bun run test:e2e --filter=server`.
