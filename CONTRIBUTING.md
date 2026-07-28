# Contributing to Upstand

Thank you for helping improve Upstand. Small, reviewable pull requests are easier to test and release than large rewrites. Please read this guide together with the repository documentation and the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

1. Search existing issues and pull requests before opening a duplicate.
2. For a security concern, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
3. For a substantial feature, open an issue first so the design, scope, and backwards-compatibility plan are agreed.
4. Fork the repository or create a branch from `master`. Keep `master` release-ready; use `canary` only for explicitly experimental integration work.

## Development setup

Install Bun 1.3.14 and Docker Desktop (or Docker Engine with Compose v2), then run:

```bash
git clone https://github.com/upstandplatform/upstand.git
cd upstand
bun setup
bun dev
```

`bun setup` is safe to re-run. It creates ignored local environment files for the API and web app from the checked-in examples, installs the frozen lockfile, starts local PostgreSQL 18 and Redis 8.8, waits for PostgreSQL, synchronizes only the local database password without deleting data, and applies the checked-in migrations. The PostgreSQL 18 upgrade intentionally uses the versioned `postgres_data_v18` volume; if you need old local data, follow the database upgrade runbook first. `bun dev` starts the API, web console, and Fumadocs together.

Next.js production builds use Turbopack by default. Local development uses the
Webpack dev server because the current Next.js Turbopack dev server can return
404s for deep dynamic dashboard routes in this monorepo. The `build:webpack`
script remains an explicit diagnostic fallback; CI, Docker images, and release
builds use the default Turbopack production build.

- Web console: `http://localhost:3001`
- API Swagger UI: `http://localhost:3000/api/docs/`
- Fumadocs: `http://localhost:4000`

Use throwaway local credentials. Do not commit `.env` files, private keys, production URLs, database dumps, or generated secrets. For schema changes, update the TypeScript schema, run `bun run db:generate`, and test the generated migration against both a fresh database and an upgraded database. Never create migration files manually.

## Making a change

- Keep business rules in `packages/usecases` or `packages/domain`, not in UI components or transport adapters.
- Keep API contracts in the tRPC routers and validate external input with Zod.
- Keep shared UI primitives in `packages/ui`; avoid duplicating accessible components in individual apps.
- Treat authentication, organization authorization, secret encryption, Docker commands, SSH, and notification delivery as security-sensitive paths.
- Do not add mocks, fake success states, or unhandled TODOs for user-facing functionality.
- Preserve rollback behavior and existing database data. Add a migration for schema changes; never edit an applied migration.
- Add or update tests for changed behavior, especially deployment, update, Caddy, notification, and authorization flows.

## Branches, changes, and releases

Upstand uses a small GitHub Flow: `canary` is the integration branch and
`master` is the stable release branch. Do not commit directly to either branch.
You do not need the Git Flow CLI.

Before starting work, synchronize the integration branch:

```bash
git fetch origin --prune
git switch canary
git pull --ff-only origin canary
```

### Contributors: features and fixes

Use a short `feat/`, `fix/`, `docs/`, or `chore/` branch for a feature,
refactor, documentation change, or ordinary bug fix:

```bash
git switch -c feat/short-description
# edit files, then add a Changeset for user-visible behavior
bun changeset
bun run check:staged
bun run check-types
bun test packages
git push -u origin HEAD
```

Open the pull request against `canary`. Keep it small and describe the tests,
migrations, deployment impact, and rollback plan. CI is the source of truth;
local hooks provide fast feedback but should not be bypassed to hide a failure.

The CI lanes are intentionally split to avoid rebuilding the same artifact at
every branch boundary. Pull requests run formatting, migration checks, type
checks, and affected package tests. After a merge to `canary`, one full
type/test validation runs; the canary image workflow is the production-shaped
application build and builds and publishes the images once. This avoids
compiling the applications in CI and immediately compiling them again in
Docker. The `canary` to `master` promotion reuses that validated integration
result; the stable workflow is responsible for the immutable tag and
production image publication.

```bash
git fetch origin --prune
git switch canary
git pull --ff-only origin canary
git branch -d feat/short-description
```

### Maintainers: releases

Changesets owns release intent, version updates, and changelog generation. The
automated release PR is created after Changesets land on `canary`. Review and
merge it into `canary`, then promote the resulting commit to `master` through a
pull request. The stable-tag workflow creates the immutable
`vMAJOR.MINOR.PATCH` tag and dispatches the reusable image publishing workflow.

If the Changesets workflow reports that GitHub Actions cannot create or approve
pull requests, keep the repository token read-only and either enable the
organization setting that permits Actions to create and approve pull requests,
or configure the narrowly scoped `RELEASE_TOKEN` repository secret. The
generated `changeset-release/canary` branch can be opened as a PR manually
while that setting is being changed.

Never move an existing release tag. A correction becomes the next patch
release; for example, `v0.1.0` stays immutable and the correction is `v0.1.1`.
Do not run `changeset publish`, edit generated versions manually, or publish
mutable Docker tags as a release artifact.

### Urgent production fixes

Create `fix/urgent-description` from `master`, add a Changeset, open the pull
request into `master`, and then back-merge the same fix into `canary`. Use this
only for an active production issue; normal work always starts from `canary`.

See [RELEASING.md](RELEASING.md) for the maintainer checklist, retry commands,
and rollback procedure.

## Required checks

Run the relevant focused checks while iterating, then all checks before requesting review:

```bash
bun run check-types
bun run lint
bun test packages
bun run build
git diff --check
```

If a check cannot run locally, say why in the pull request and provide the closest reproducible verification. Do not hide failures by weakening a script or deleting a test.

## Pull requests

Use a clear title in imperative form, for example `fix: preserve Caddy route order`. A pull request should include:

- The problem and user-visible outcome.
- A concise implementation summary.
- Tests and commands run, including any limitations.
- Migration, environment-variable, deployment, or rollback notes.
- Screenshots or a short recording for UI changes.
- Explicit security considerations for auth, SSH, secrets, Docker, or external network calls.

Keep unrelated formatting changes out of the PR. Resolve review feedback with follow-up commits while the PR is under review; maintainers may squash when merging.

## Commits and releases

Use conventional prefixes such as `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `build:`, and `chore:`. Release tags use `vMAJOR.MINOR.PATCH` and trigger the release workflow. A release must pass type checks, tests, builds, and image publication before it is announced. See [CHANGELOG.md](CHANGELOG.md) and [updates documentation](apps/fumadocs/content/docs/updates.mdx).

## Maintainer checklist

Before merging, confirm CI is green, migrations are reversible or safely additive, secrets are not logged, notifications are wired for new asynchronous operations, docs cover the operator workflow, and the release/rollback path has been tested in a disposable environment.
