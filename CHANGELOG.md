# Changelog

All notable releases of Upstand are recorded here. Release tags use semantic versioning (`vMAJOR.MINOR.PATCH`).

## Unreleased

## 0.2.3 - 2026-08-17

Polish the Projects dashboard for clearer project scanning, quieter card actions, and an accurate no-results search state.

## 0.2.2 - 2026-08-16

Harden container file management around explicitly selected full container IDs and named Docker volumes. File operations are now mount-scoped, symlink-safe, bounded, binary-safe, atomic for writes, and reject read-only or non-canonical targets. The release also removes runtime compatibility paths that accepted legacy labels, plaintext secret documents, abbreviated container IDs, legacy installer artifacts, and non-paginated backup adapters.

## 0.2.1 - 2026-08-15

Make local self-hosted and cloud development runtimes safely switchable with isolated persistent state, and add a disposable Multipass remote-server lab for end-to-end provisioning tests.

## 0.2.0 - 2026-08-09

Ship the Windows app as Upstand, run its bundled control plane from a verified
standalone Bun executable, and make Squirrel install, restart, and uninstall
lifecycle handling reliable.

Add production deployment plans and capability policy, resumable workload and control-plane migration workflows, portable encrypted transfers, correlated operational telemetry, GitHub diagnostics, operator runbooks, and matching dashboard and CLI controls.

## 0.1.55 - 2026-08-08

Harden stable release acceptance and dependency recovery so production images can be verified and published reliably.

## 0.1.54 - 2026-08-08

Harden stable release acceptance and dependency recovery so production images can be verified and published reliably.

## 0.1.53 - 2026-08-04

Allow the operational status rehearsal to use its writable executable temporary workspace while retaining production read-only hardening.

## 0.1.52 - 2026-08-04

Allow the read-only operational rehearsal to use Bun's executable temporary workspace while keeping the production services hardened.

## 0.1.51 - 2026-08-04

Keep the read-only production operational-status rehearsal compatible with Bun's runtime cache behavior.

## 0.1.50 - 2026-08-04

Use the server liveness endpoint for the container healthcheck so Swarm startup cannot deadlock while schedules waits for the server to bind.

## 0.1.49 - 2026-08-04

Initialize the monitoring agent data directory with non-root ownership so its persistent SQLite volume can start successfully under the hardened runtime identity.

## 0.1.48 - 2026-08-04

Make hosted production acceptance pass the disposable network override to the server and keep the monitoring image healthcheck self-contained.

## 0.1.47 - 2026-08-04

Reuse an already-present immutable monitoring image during provisioning and pre-pull it in the release acceptance harness, so private GHCR images do not require credentials inside the production container.

## 0.1.46 - 2026-08-04

Publish CLI releases automatically from trusted GitHub Actions OIDC credentials with npm provenance and immutable-content retry checks.

Use explicit Swarm-compatible tmpfs mounts so read-only production services retain their required writable temporary paths.

Capture bounded server and schedules service logs, health responses, and container state when bundled production acceptance does not converge.

## 0.1.45 - 2026-08-04

Make production acceptance process-identity checks portable across minimal stateful images.

## 0.1.44 - 2026-08-04

Prevent the schedules startup gate from deadlocking against server readiness.

## 0.1.43 - 2026-08-04

Use the runtime available in each production image for web and documentation healthchecks.

## 0.1.42 - 2026-08-04

Run bundled service healthchecks as direct Bun commands without shell-dependent quoting.

## 0.1.41 - 2026-08-03

Use Bun directly for production healthchecks in the bundled Compose stack.

## 0.1.40 - 2026-08-03

Use the Bun runtime for bundled API and schedules healthchecks instead of assuming curl is installed.

## 0.1.39 - 2026-08-03

Run the bundled PostgreSQL service as its explicit non-root runtime identity.

## 0.1.38 - 2026-08-03

Run the bundled Redis service as its explicit non-root runtime identity.

## 0.1.37 - 2026-08-03

Fix production acceptance when stateful images do not provide `ps` for `docker top`.

## 0.1.36 - 2026-08-03

Fix production acceptance validation for Docker's normalized capability names.

Prepare the next stable patch release with the hosted production acceptance and dependency security fixes.

## 0.1.35 - 2026-08-03

Patch release for the production dependency security update.

## 0.1.34 - 2026-08-03

Harden the hosted production acceptance rehearsal for Docker Swarm capability differences.

## 0.1.33 - 2026-08-03

Promote the OpenTUI CLI and browser device authentication in the next stable patch release.

## 0.1.32 - 2026-08-02

Release 0.1.32 setting up Docker Buildx before logging in to GHCR in pre-release-acceptance job.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.31 - 2026-08-02

Release 0.1.31 adding desktop payload builds for server and web before running electron-forge make in release workflow.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.30 - 2026-08-02

Release 0.1.30 fixing metadataBase fallback URL in fumadocs and skipping nested node_modules during desktop payload staging.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.29 - 2026-08-02

Release 0.1.29 fixing step-level env evaluation for BACKUP_REHEARSAL_LOG in release workflow.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.28 - 2026-08-02

Release 0.1.28 ensuring BACKUP_REHEARSAL_LOG and ACCEPTANCE_EVIDENCE_DIR are defined in release workflow job env.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.27 - 2026-08-02

Release 0.1.27 ensuring all shell scripts have executable permissions.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.26 - 2026-08-02

Release 0.1.26 supporting explicit zero latency limits in health-load-rehearsal script.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.25 - 2026-08-02

Release 0.1.25 fixing latency budget test threshold in health-load-rehearsal test script.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.24 - 2026-08-02

Release 0.1.24 adding @upstand/env to root devDependencies.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.23 - 2026-08-02

Release 0.1.23 with high-level audit filter for dependency security checks.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.22 - 2026-08-02

Release 0.1.22 removing unused env import from drizzle.config.ts.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.21 - 2026-08-02

Release 0.1.21 removing unused env import from drizzle.config.ts.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.20 - 2026-08-02

Release 0.1.20 decoupling drizzle.config.ts from server runtime environment validation.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.19 - 2026-08-02

Release 0.1.19 with job-level release workflow environment variables fix.

Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

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
