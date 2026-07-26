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

`bun setup` is safe to re-run. It creates ignored local environment files for the API and web app from the checked-in examples, installs the frozen lockfile, starts local PostgreSQL and Redis, waits for PostgreSQL, synchronizes only the local database password without deleting data, and applies the checked-in migrations. `bun dev` starts the API, web console, and Fumadocs together.

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

## Git Flow for contributors and maintainers

Upstand uses Git Flow with `canary` as the integration branch and `master` as the release-ready branch. Do not commit directly to either branch. Contributors should start work from the latest `canary`, publish a feature or bug-fix branch, and open a pull request back to `canary`.

### Install and initialize Git Flow

Install the `git-flow` CLI using your operating system's package manager, then initialize it once in the repository:

```bash
git flow init
```

Use these values when prompted:

```text
Production releases: master
Development branch: canary
Feature branches: feature/
Release branches: release/
Hotfix branches: hotfix/
Version tag prefix: v
```

If Git Flow has already been initialized with the wrong development branch, rerun `git flow init` and select `canary`. Verify the configuration with `git config --get-regexp '^gitflow\.'`.

Before starting work, synchronize both the remote references and your local integration branch:

```bash
git fetch origin --prune
git switch canary
git pull --ff-only origin canary
```

### Contributors: features and fixes

Use a feature branch for a feature, refactor, documentation change, or ordinary bug fix. Start it from `canary`:

```bash
git flow feature start short-description
# edit files, then run the relevant checks
git add <files>
git commit -m "feat: describe the change"
git flow feature publish short-description
```

`git flow feature publish` pushes `feature/short-description` to the remote so it can be reviewed. Open the pull request against `canary`, keep committing to the same branch while review is in progress, and do not run `git flow feature finish` before the pull request is merged. After the pull request is merged, remove the local branch if it is no longer needed:

```bash
git fetch origin --prune
git switch canary
git pull --ff-only origin canary
git branch -d feature/short-description
```

Use `git flow feature pull origin short-description` when you need to check out or update another contributor's published feature branch locally. Use `git flow feature track short-description` when the branch already exists remotely but is not present locally.

### Maintainers: releases and Changesets

Changesets owns release intent, version updates, and changelog generation. The deployable applications (`server`, `schedules`, `web`, and `fumadocs`) are fixed to one release version; the root package version and root `CHANGELOG.md` are synchronized by the version script.

For every user-visible change, add a changeset on the feature branch:

```bash
bun changeset
```

Choose the release level and describe the user-visible change. For documentation-only or internal changes that should not change the product version, use `bun changeset --empty`.

After changesets are merged into `canary`, GitHub Actions opens or updates the automated `chore: prepare release` pull request. That pull request runs `bun run changeset:version`, updates application versions, generates package changelogs, updates the root changelog, and removes consumed changesets. Review the generated release PR, migrations, image changes, and rollback notes before merging it.

When the release PR is merged and the release-ready changes reach `master`, GitHub Actions creates the next `vMAJOR.MINOR.PATCH` tag automatically. The existing tag-triggered release workflow then verifies the tag is on `master` and publishes the immutable Docker images. Do not run `changeset publish`, create release tags manually, or edit generated version/changelog files by hand.

### Maintainers: urgent production fixes

Use a hotfix branch when a fix must be released from `master` before the next planned release. Start it from the current production branch:

```bash
git switch master
git pull --ff-only origin master
git flow hotfix start 0.1.75
# make and test the minimal production fix
git flow hotfix finish 0.1.75
git push origin master canary --follow-tags
```

Finishing a hotfix merges it into both `master` and `canary`, creates the `v0.1.75` tag, and removes the local hotfix branch. Resolve any conflicts carefully so the fix is not lost from either branch. Use a normal feature branch for non-urgent work; do not use a hotfix branch simply because a change is small.

### Command reference

| Situation               | Command                             | Branch/result                                      |
| ----------------------- | ----------------------------------- | -------------------------------------------------- |
| Start normal work       | `git flow feature start <name>`     | Creates `feature/<name>` from `canary`             |
| Publish work for review | `git flow feature publish <name>`   | Pushes the feature branch                          |
| Add release intent       | `bun changeset`                    | Adds a changeset file to the feature branch       |
| Prepare the release      | GitHub Actions                    | Opens/updates the version and changelog PR        |
| Create stable release    | Merge release to `master`         | Creates `v<version>` and starts image publication |
| Start an urgent fix     | `git flow hotfix start <version>`   | Creates `hotfix/<version>` from `master`           |
| Complete a hotfix       | `git flow hotfix finish <version>`  | Merges to `master` and `canary`, tags `v<version>` |

Use `git flow <type> list` to inspect local branches and `git flow <type> delete <name>` only after the corresponding pull request or release has been completed and the remote branch is no longer needed.

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
