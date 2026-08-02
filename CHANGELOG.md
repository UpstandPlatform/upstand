# Changelog

All notable releases of Upstand are recorded here. Release tags use semantic versioning (`vMAJOR.MINOR.PATCH`).

## Unreleased

## 0.1.18 - 2026-08-02

Release 0.1.18 with job-level environment variables fix for db verification step.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.17 - 2026-08-02

Release 0.1.17 with release workflow environment variables fix and verified server assignment logic.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.16 - 2026-08-02

Release 0.1.16 with release workflow environment variables fix and verified server assignment logic.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.15 - 2026-08-02

Release 0.1.15 with clean lockfile and verified server assignment logic.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.14 - 2026-08-02

Release 0.1.14 with clean lockfile and verified server assignment logic.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.13 - 2026-08-02

Release 0.1.13 with clean lockfile and verified server assignment logic.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.12 - 2026-08-02

Release 0.1.12 with clean lockfile and verified server assignment logic.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.11 - 2026-08-02

Fix server_id assignment for local manager resources, prevent unassigned server notice in self-hosted mode, and permit unencrypted attachable overlay networks in development environments.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.10 - 2026-08-02

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.9 - 2026-08-02

Add the authenticated OpenShip-style workspace dashboard at `/workspace`, expose canonical control-plane capabilities to the UI, and make the desktop client open the workspace route after connecting. Existing dashboard routes remain available.

Harden production authorization, secret isolation, public endpoint admission controls, scheduler execution, AI/MCP limits, and stateless container security.

Remove non-existing routes and concepts from GlobalSearch and workspace shell navigation.

Harden production tenancy boundaries, including AI deployment-history scoping, API-key organization binding, bounded SQL-backed global search projections, tenant-scoped SQL resource ID projections, metadata-only environment listing without secret hydration, a dedicated recent-2FA environment secret capability, bounded repository reads and AI conversation history, read-time encryption upgrades for legacy resource and environment secret rows, secret-free Caddy routing projections, success-only preview routing projections, non-secret autoscaling projections, credential-free scheduled Docker cleanup discovery, batched and bounded queue/history resource summaries and deployment labels, S3 destination update authorization, instance-wide Swarm access, local Docker inventory/control access, container/volume upload authorization, privileged database command authorization, outbound endpoint policy, Caddy forward-auth SSRF protection, webhook delivery, GitHub App manifest callbacks, backup organization and certificate referential integrity, deployment migration ownership checks, pending-invite SSO enforcement, server-scoped routing reconciliation, bounded Redis operations, bounded tenant topology reads, bounded Docker metrics collection, remote monitoring Docker-socket group propagation, AI usage limits and MCP request deadlines, backup execution, queue observability, migration and startup safety, serialized self-updates, terminal sessions, readiness probes, encrypted local parity networking, custom network propagation, Swarm-compatible non-root runtime identity, Swarm-effective container hardening, installer encrypted-network runtime probing, bounded installer downloads, bounded archive extraction processes, bounded privileged Docker archive validation, runtime acceptance verification including task-container health coverage, deployment image revisioning, release image manifest verification and pinning, explicit audited release-tag installation, installer persistence and validation of security/operations configuration, stateful database entrypoint capability minimization, browser replay-memory bounds, Mermaid SVG sanitization, safe browser handling of catalog and provider URLs, cursor-paged backup retention and schedule cleanup, production acceptance network-attachment and monitoring-image checks, routable release Swarm initialization, bundled and external-data HA release acceptance rehearsals with a contract guard, production build verification, Chromium/Firefox/WebKit public browser smoke coverage, deduplicated schedules operational alerts for Redis, queues, outbox, and backup freshness, production documentation that routes operators through the audited installer instead of an unsafe mutable-tag Compose quickstart, generated authentication for managed databases with fail-closed deployment when legacy resources have no credentials, and a pinned libSQL managed-database image default.

## 0.1.8 - 2026-07-29

Promote the corrected desktop installer fix as the next Upstand platform patch release.

Fix Linux desktop installers by aligning the Debian launcher with the packaged executable name.

## 0.1.7 - 2026-07-29

Add the production desktop client with secure control-plane connection handling,
release installers, and an in-product download path. Validate Railpack
deployment compatibility with the vendored OpenShip fixture matrix.

## 0.1.6 - 2026-07-29

chore(deps): update production dependencies via Dependabot (#25).

Harden tenant isolation, authentication, external network access, archive uploads, and secret-provider workflows.

Improve audit-log pagination and search, bound external response bodies, parallelize topology discovery, and reduce unnecessary dashboard loading and reconciliation work.

## 0.1.5 - 2026-07-29

Avoid reporting expected non-member authorization denials as audit persistence failures, keep zero-configuration installs on the latest stable image release, and reliably provision the monitoring agent when its development image and container share a name.

## 0.1.4 - 2026-07-28

Harden service startup and monitoring callbacks, improve local dashboard route
reliability, and expand authenticated E2E coverage across topology, resource
configuration, schedules, backups, deployment history, and lifecycle failure
boundaries.

Make the production installer use the latest stable GHCR release images by
default and resolve them to immutable digests. Source builds remain available
through an explicit opt-in.

## 0.1.3 - 2026-07-28

Improve dashboard navigation rendering, keep topology selection highlighting linear as graphs grow, use Turbopack for the default Next.js builds, and upgrade the bundled PostgreSQL and Redis images for new deployments.

This change only improves test isolation and does not require a package release.

## 0.1.2 - 2026-07-28

Make source-based installations resilient when the Go module proxy returns a temporary or policy-based HTTP error.

Guide first-time users to create an organization before creating a project.

## 0.1.1 - 2026-07-28

Improve topology visibility, terminal workflows, authorization behavior, and local development verification across the Upstand applications.

## 0.1.0 - 2026-07-26

The first Upstand release in the new `UpstandPlatform/upstand` repository.

### Added

- Unified cloud and self-hosted operation across the control plane, web application, schedules, workers, and monitoring agent.
- Resource, deployment, web-server, project, environment, secret, backup, certificate, terminal, and domain management workflows.
- Git-based deployments, Compose and Swarm resource support, deployment history, rollback, health checks, and lifecycle reconciliation.
- Runtime-configured web images, direct-IP access controls, HTTPS and domain guardrails, and Caddy integration.
- UpGal AI assistance with bounded tools, authorization-aware mutations, persistent conversations, and safe web search integration.
- Local development, self-hosting, Docker Compose, installation, upgrade, and release workflows.

### Security and reliability

- Hardened Docker resource ownership, archive validation, outbound network policy, API authorization, rate limiting, secret handling, and terminal access.
- Added idempotent monitoring-agent startup and reconciliation so concurrent server initialization cannot produce duplicate-container conflicts.
- Hardened monitoring-agent containers with immutable images, dropped capabilities, no-new-privileges, read-only roots, bounded resources, and rotated logs.
- Added database migrations and runtime safeguards for deployment lifecycle, build environment variables, server access, and certificate-backed backups.
- Added structured operational logging, health/readiness contracts, stale-deployment reconciliation, and bounded cleanup behavior.

### Validation

- Type checking, linting, unit and integration tests, production builds, Go tests and vetting, database checks, dependency audit, static analysis, and Dockerfile/Compose validation pass for the release snapshot.
