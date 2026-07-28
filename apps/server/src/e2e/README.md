# Server E2E tests

The E2E tests are intentionally grouped by workflow so failures are easy to
locate:

- `integration-contracts.e2e.test.ts` checks public health, OpenAPI, and auth
  boundaries.
- `resource-lifecycle.e2e.test.ts` checks live container identity, state
  preservation, and lifecycle command validation.
- `deployment-workflows.e2e.test.ts` checks resource/deployment joins, runtime
  observability, and rollback/deploy validation.
- `topology-and-operations.e2e.test.ts` checks topology node/edge integrity,
  server filtering, resource configuration, schedules/cron jobs, backup
  queries, and disposable update/cleanup workflows for redeploy and rollback
  boundaries.

The suite is safe to run without a local server: unavailable services are
skipped with a bounded timeout. Read-only resource tests require:

```powershell
$env:E2E_AUTH_COOKIE="better-auth.session_token=..."
$env:E2E_RESOURCE_ID="..."
```

For a disposable local run, `E2E_API_KEY` may be used instead of a browser
session cookie. Use a short-lived key created only in the local test
organization; never use a production key.

Deployment and container mutation checks additionally require:

```powershell
$env:E2E_ALLOW_MUTATIONS="1"
```

The mutation suite uses the configured resource as a disposable test target and
restores its description, ports, mounts, and schedules in cleanup. Backup
schedule mutation coverage also requires `E2E_BACKUP_DESTINATION_ID` pointing
to a test-only destination. Do not enable mutations against production data.

Run all server tests with `bun run test --filter=server` from the repository
root, or only E2E tests with `bun run test:e2e --filter=server`.
