# Testing Upstand

Use Bun 1.3.14 from the repository root. Run `bun setup` first when local
PostgreSQL, Redis, or Docker-backed workflows are required.

## Before opening a pull request

```bash
bun run verify
```

This runs type checks, lint, the full unit and integration test suite, all
production builds, and `git diff --check`.

## Focused checks

Run the smallest relevant check while iterating:

```bash
bun run test --filter=@upstand/usecases
bun run test --filter=server
bun run test:e2e --filter=server
bun run check-types --filter=web
bun run lint --filter=@upstand/api
```

The server E2E suite is opt-in and needs the local server and disposable test
credentials configured in `.env.example`. It is not a substitute for the
deterministic package tests.

## Database, deployment, and release changes

- For database changes, run `bun run db:generate`, inspect generated files,
  then run `bun run db:check`. Verify the generated migration against fresh
  and upgraded disposable databases; never use a shared or production target.
- For deployment pipeline or fixture changes, run focused infrastructure
  pipeline tests and the applicable server E2E workflows. Keep external Docker,
  SSH, registry, DNS, and cloud boundaries deterministic in regular CI tests.
- For desktop packaging changes, run `bun run --cwd apps/desktop package`
  followed by `bun run --cwd apps/desktop verify:packaged-server`.
- For release workflow changes, run the release contract scripts under
  `scripts/` that cover the edited workflow or rehearsal. Keep the stable-tag
  acceptance gate enabled.

If a required check cannot run locally, report the exact reason and the
closest reproducible verification performed.
