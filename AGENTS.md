# Upstand Agent Guide

## Repository overview

Upstand is a Bun 1.3.14 monorepo managed by Turborepo. It contains a TypeScript
control plane, Next.js web console, background scheduler, Electron desktop
client, Go monitoring service, and shared packages. Read the relevant package
README plus `ARCHITECTURE.md`, `CONTRIBUTING.md`, and `TESTING.md` before making
non-trivial changes.

Use Bun for package scripts and tests. Do not introduce npm, Yarn, or pnpm
lockfiles or replace workspace scripts with tool-specific one-off commands.

These root instructions apply to the entire repository. A future package or
application may add a more specific `AGENTS.md`, but a nested guide must not
contradict these architecture, security, generated-file, or verification
rules. Prefer updating the relevant existing documentation when a rule is
project-wide rather than adding duplicated instructions.

## Package map

- `packages/domain` — business entities, value objects, validation, errors, and
  repository ports. This is the innermost layer and must remain independent of
  framework, runtime, database, and other workspace packages.
- `packages/usecases` — application workflows, business orchestration, ports,
  DI tokens, and application-level validation. It may depend on domain and
  approved cross-cutting/runtime packages, but not on API, auth, database,
  repositories, or UI packages.
- `packages/infrastructure` — external adapters such as Docker, Caddy,
  monitoring, notifications, secrets, provisioning, outbox, and Redis-backed
  integrations.
- `packages/repositories` — persistence implementations and Drizzle-backed
  repository adapters. Repository interfaces belong in the domain or
  application layer; implementations belong here.
- `packages/db` — PostgreSQL client, Drizzle table definitions, migrations,
  and database lifecycle/migration helpers.
- `packages/redis` — Redis connection and queue runtime infrastructure.
- `packages/platform` — reusable OS and cryptographic capabilities, including
  SSH and secret-encryption operations.
- `packages/api` and `packages/auth` — composition and interface adapters:
  tRPC/Hono routers, authorization middleware, Better Auth configuration, and
  dependency-injection wiring.
- `packages/ui` — shared React UI primitives, hooks, styles, and components.
- `packages/env` and `packages/config` — environment validation and shared
  TypeScript/tooling configuration.
- `apps/server` — API process and startup/migration wiring.
- `apps/web` — Next.js dashboard.
- `apps/schedules` — background jobs and schedulers.
- `apps/fumadocs` — documentation site.
- `apps/desktop` — Electron client.
- `apps/monitoring` — standalone Go monitoring service.

Package boundaries are enforced by Turbo tags and
`packages/config/src/architecture.test.ts`. Preserve the dependency direction:
business policy points inward; framework, persistence, and external services
are assembled at the application edge. Do not bypass package exports with
private-path imports. DI tokens are declared only in
`packages/usecases/src/tokens.ts` or `packages/repositories/src/tokens.ts` and
consumers must import those canonical tokens.

## Implementation conventions

- Keep business rules in `packages/domain` or `packages/usecases`, not in UI,
  routers, controllers, auth callbacks, or infrastructure adapters.
- Keep transport concerns in `packages/api`. Define tRPC routers under
  `packages/api/src/routers`, validate external input with Zod, and use the
  shared procedure/middleware helpers for rate limiting, authentication,
  authorization, step-up authentication, and auditing.
- Put repository contracts in domain/application interfaces and keep SQL,
  Drizzle expressions, transactions, and persistence mapping in
  `packages/repositories` or `packages/db`.
- Use a use-case plus repository/unit-of-work flow for application behavior.
  Do not make use cases import Drizzle tables or reach directly into the
  database client.
- Keep feature code grouped by responsibility. Existing conventions include
  feature directories, kebab-case filenames, `*.usecase.ts`,
  `*.repository.ts`, `*.helper.ts`, and colocated `*.test.ts` files.
- Name exported classes and types in PascalCase, functions and variables in
  camelCase, and Zod schemas with a PascalCase `Schema` suffix. Prefer explicit
  input/result types and `unknown` plus validation over unbounded `any`.
- Follow the repository's ESM TypeScript style: two-space indentation,
  semicolons, double-quoted strings, type-only imports where appropriate, and
  organized imports. Biome is authoritative for formatting and linting; do
  not add a competing formatter configuration.
- Use structured `evlog` logging with useful context. Do not log secrets,
  tokens, passwords, private keys, raw credentials, or sensitive request data.
- Treat authentication, organization authorization, SCIM/SSO, API keys,
  secret encryption, SSH, Docker command execution, migrations, and external
  network calls as security-sensitive. Preserve existing validation,
  authorization, audit, rollback, and cleanup behavior when changing them.
- Do not add fake success states, silent fallbacks that hide failures, or
  untracked TODOs for user-facing behavior.

## Database and generated files

`packages/db` is the only database schema/migration package. The following
workflow is mandatory:

1. For application-owned tables, edit the appropriate TypeScript schema under
   `packages/db/src/schema/` and keep relations, indexes, constraints,
   nullability, defaults, and delete behavior explicit.
2. For Better Auth tables or fields, edit the Better Auth configuration and
   plugins in `packages/auth/src/` instead of editing the generated auth schema.
3. Run `bun run db:generate` from the repository root. This is the supported
   generator entry point: it runs Drizzle Kit and regenerates the Better Auth
   schema from the checked-in Better Auth configuration as part of the same
   workflow.
4. Review the generated SQL and metadata, then run the relevant checks against
   both a fresh database and an upgraded database.

Never hand-write, rename, reorder, or “fix” files under
`packages/db/src/migrations/` or `packages/db/src/migrations/meta/`. Never edit
an applied migration. Migrations are generated automatically by `drizzle-kit`
through `db:generate` and must be committed together with the schema/config
change that produced them.

Never manually manipulate `packages/db/src/schema/auth.ts`. It is generated
automatically by the `db:generate` workflow from Better Auth configuration.
If the generated auth tables are wrong, fix `packages/auth/src/index.ts` (or
the relevant Better Auth plugin/configuration), rerun `bun run db:generate`,
and review the resulting diff. Do not use a separate ad-hoc Better Auth schema
generation command.

Use these root commands for database work:

```bash
bun run db:generate   # generate Drizzle migrations and generated auth schema
bun run db:check      # validate migration consistency
bun run db:migrate    # apply committed migrations to DATABASE_URL
bun run db:push       # push schema only when the task explicitly calls for it
bun run db:studio     # inspect the local database
```

Do not use `db:push` as a substitute for a migration in a change that must be
deployed. Preserve existing data and design additive, reversible, or otherwise
carefully justified changes. Never commit `.env` files, database dumps, local
credentials, private keys, or generated secrets.

Other generated or protected content follows its local source-of-truth
workflow:

- Treat `routeTree.gen.ts` and Fumadocs-generated output such as `.source/` as
  generated artifacts. Change the source routes or documentation, then run the
  owning generator; do not hand-edit generated output.
- Treat `fixtures/deploy` as first-party Upstand source code used to
  exercise our deployment behavior. The directory name is historical; do not
  describe these fixtures as vendored, verbatim, or owned by OpenShip, and do
  not add upstream commit/hash checks. Modify and extend the fixtures when
  needed to cover Upstand behavior, including `upstand.json` project
  configuration scenarios.
- Files emitted by runtime integrations and marked as managed, such as Caddy
  configuration, must be changed through the owning Upstand service or
  generator rather than edited directly on the managed host.

Use `.env.example` files and disposable local credentials for development. Do
not print, expose, copy, or commit `.env` contents, tokens, cookies, private
keys, database dumps, or production connection strings. Never run destructive
database, Docker, or cleanup commands against production, shared, or unknown
environments; confirm the target and use the repository's scoped local scripts.

## Tests and verification

Tests live beside the package or app that owns the behavior. Use `.test.ts` or
`.test.tsx` for unit/integration tests and `.e2e.test.ts` for server black-box
tests under `apps/server/src/e2e/`. Prefer focused tests while iterating, then
run the broad checks appropriate to the change:

### Deployment fixture and pipeline tests

Fixture tests are first-party integration tests, not upstream compatibility
checks. They must exercise the same Upstand pipeline used by production:
composition root/DI, API or use-case entry points, repositories and database,
outbox/queue handling, scheduler workers, build orchestration, deployment
orchestration, and status/log persistence. Do not call private methods on a
service or assert only that a mocked command was constructed correctly when the
behavior can be tested through the real pipeline.

For a representative fixture scenario, the test should use the actual Upstand
flow to:

1. Create a project.
2. Create and configure an environment.
3. Create or register the required remote application and database servers.
4. Exercise build, deploy, redeploy/rollback where applicable, and database
   storage/persistence.
5. Assert API/use-case results, persisted entities and relationships, resource
   state transitions, deployment history, logs, generated configuration, and
   the mocked remote-server state.

Mock only external boundaries that would make the test slow, nondeterministic,
or unsafe: Docker/Swarm, SSH, Git providers, container registries, S3, DNS,
email, third-party HTTP APIs, and other remote services. Use deterministic
in-memory or test adapters behind the same interfaces used by production. Do
not mock the use case, router, repository, scheduler, queue, or deployment
pipeline under test; doing so turns an end-to-end test into an implementation
test.

The fixture matrix must cover both self-hosted and cloud modes, multiple
remote-server targets (including application and database servers), relevant
build/deployment/database configurations, and organization/authorization
boundaries where they affect behavior. Use real Upstand project configuration
files such as `upstand.json`; do not substitute legacy `openship.json` files
or test a different product's configuration format. Add a focused scenario for
each regression and keep at least one complete project-to-persistence-to-
deployment path for every supported mode.

Keep fast mocked pipeline tests deterministic and runnable in CI. Real Docker,
Swarm, network, registry, or cloud smoke tests may be separate opt-in suites,
but they do not replace the required mocked end-to-end coverage. Assertions
must focus on observable Upstand behavior and durable state, not incidental
private method call counts or command ordering.

```bash
bun run check-types
bun run lint
bun run test
bun run build
git diff --check
```

For database changes, also run `bun run db:check` and verify migration behavior
on a disposable fresh database and an upgraded database. For server behavior,
use `bun run test --filter=server` and, when applicable,
`bun run test:e2e --filter=server`. For deployment fixture changes, run the
focused infrastructure pipeline tests and the relevant server E2E workflows.
If a check cannot run locally, report the exact reason and the closest
verification performed.

Match CI's generated-schema verification before handoff:

```bash
bun run db:generate
bun run db:check
git diff --exit-code -- packages/db/src/migrations packages/db/src/schema
```

The local Git hooks also run `bun run check:staged`, `bun run check-types`, and
`bun test packages`; use those commands when validating staged or package-level
changes.

## Change hygiene

- Inspect `git status` and the surrounding implementation before editing.
  Preserve unrelated or pre-existing user changes; do not reset, checkout, or
  overwrite them.
- Keep changes small and reviewable. Update tests and relevant docs when
  behavior, operations, environment variables, migrations, or rollback paths
  change.
- Follow the repository's branch and release guidance in `CONTRIBUTING.md`.
  User-visible changes generally require a Changeset; do not edit generated
  release versions or changelogs by hand.
- Before handing off, summarize changed files, tests/checks run, migration or
  deployment impact, and any limitation that remains.
