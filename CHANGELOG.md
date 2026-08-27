# Changelog

All notable releases of Upstand are recorded here. Release tags use semantic versioning (`vMAJOR.MINOR.PATCH`).

## Unreleased

## 0.2.27 - 2026-08-27

Prevent Compose CLI interpolation from inheriting unrelated control-plane environment variables or Docker transport credentials.

Wrap web, Tavily, and MCP tool results in bounded, machine-checkable untrusted-data provenance envelopes before model exposure.

Reject Compose build, Dockerfile, env-file, and extension paths that can escape the generated deployment directory, and disable external Compose includes and SSH-agent forwarding during builds.

Serialize pull-request preview quota decisions per resource to prevent concurrent webhook deliveries from exceeding the configured limit.

Provision isolated local resource networks through an owner-validated, encrypted Docker broker capability.

Scope Compose networks and volumes through typed, owner-labelled Docker broker capabilities before deployment.

Bind deployment-worker Docker broker requests to signed, short-lived deployment scopes and refuse unscoped production deployments.

Use reviewed model pricing metadata to raise AI cost admission ceilings conservatively for known models.

Bound legacy Docker build contexts to the same streaming size limit as typed build capabilities.

Provision the local platform Caddy container through a fixed-shape, broker-validated Docker capability.

Normalize typed Docker service mount-field casing before enforcing resource ownership, closing case-insensitive volume-scope bypasses.

Route local Swarm-stack stop operations through the ownership-checked typed Docker broker teardown capability.

Scope Compose secrets and configs to the owning resource and verify Swarm file-backed resource ownership before service mutation.

Expose reviewed model pricing metadata and aggregate estimated-cost and unpriced-usage metrics for UpGal calls while retaining the operator-configured conservative admission ceiling.

Reject typed resource-service specifications that mount named volumes owned by another resource or unmanaged volume names.

Keep resolved build environment values on the BuildKit secret channel instead of Dockerfile build arguments, and reject secret-like explicit build-argument names.

Reject remote Compose build contexts so deployments cannot make the Docker daemon fetch unreviewed build input outside the bounded local build workspace.

Prevent server-rendered session requests from trusting spoofed forwarded host and protocol headers.

Scope deployment-worker Docker exec and container inspection access to the owning resource.

Bind deployment-worker Docker broker grants to their signed deployment and server targets across typed, Dockerode, and Docker CLI transports.

## 0.2.26 - 2026-08-27

Provision isolated local resource networks through an owner-validated, encrypted Docker broker capability.

Scope Compose networks and volumes through typed, owner-labelled Docker broker capabilities before deployment.

Restrict production plaintext direct-IP bootstrap and cookie normalization to private or loopback addresses.

Use reviewed model pricing metadata to raise AI cost admission ceilings conservatively for known models.

Provision the local platform Caddy container through a fixed-shape, broker-validated Docker capability.

Expose reviewed model pricing metadata and aggregate estimated-cost and unpriced-usage metrics for UpGal calls while retaining the operator-configured conservative admission ceiling.

Retry failed preview-service cleanup from durable cleanup-pending records with resource-scoped local and remote Docker capabilities.

Reserve UpGal token and cost ceilings atomically so rejected cost admission cannot consume token quota without a model call.

Reject interpolated and long-syntax host bind mounts plus host-backed Compose volume/network driver options before deployment. Typed resource service mutations now accept only safe named Docker volumes, and production Compose defaults installation-specific disaster-recovery acceptance to fail closed.

## 0.2.25 - 2026-08-21

Allow the production dashboard to reach the control plane over HTTP and WebSocket IP:port recovery URLs when a configured host is unavailable.

## 0.2.24 - 2026-08-21

Fix direct-IP cloud login recovery, prevent managed Caddy domains from being emitted twice, and allow the cloud instance owner to inspect and manage the control-plane Docker target while keeping local Docker restricted for other users. Add clearer Docker target loading and access guidance.

## 0.2.23 - 2026-08-19

Harden direct-IP runtime origin detection so domain deployments using non-standard ports keep their configured cloud API, while direct dashboard URLs continue to resolve to the local API port. Improve the login recovery state with clearer outage guidance, retry feedback, and accessible status messaging. Reclaim unused Docker images and builder artifacts before managed self-updates while preserving named volumes and rollback images.

## 0.2.22 - 2026-08-18

Fix direct IP and port runtime URL resolution and trust direct host IP origins for CORS and session authentication on cloud and self-hosted runtimes.

## 0.2.21 - 2026-08-18

Keep Active Sessions settings tab available throughout a valid authenticated session, polish the Projects dashboard for clearer scanning, quieter card actions, and responsive no-results state, and preserve release tag references during workflow attestations.

## 0.2.20 - 2026-08-17

Fix GitHub App manifest creation by removing unsupported classic Projects webhook events.

## 0.2.19 - 2026-08-16

Fix GitHub App manifest registration by removing the unsupported `setup_on_install` field.

## 0.2.18 - 2026-08-16

Allow the GitHub App manifest form to submit to GitHub while keeping the production Content Security Policy strict for scripts.

## 0.2.17 - 2026-08-16

Harden container file management around explicitly selected full container IDs and named Docker volumes. File operations are now mount-scoped, symlink-safe, bounded, binary-safe, atomic for writes, and reject read-only or non-canonical targets. The release also removes runtime compatibility paths that accepted legacy labels, plaintext secret documents, abbreviated container IDs, legacy installer artifacts, and non-paginated backup adapters.

## 0.2.16 - 2026-08-16

Fix mobile provider dialogs and make GitHub App manifest installation callbacks
reliable across cloud and self-hosted runtimes.

## 0.2.15 - 2026-08-15

Make local self-hosted and cloud development runtimes safely switchable with isolated persistent state, and add a disposable Multipass remote-server lab for end-to-end provisioning tests.

## 0.2.14 - 2026-08-15

Publish the CLI browser-login and interactive resource-selection fixes in the next Upstand patch release.

## 0.2.13 - 2026-08-14

Fix CLI browser sign-in to open the default browser on Windows and complete
device authorization for both already-authenticated and newly-authenticated
users.

Remove a duplicate internal error-message helper, make the signed-in dashboard
resolve its capability surface before rendering navigation, improve environment
comparison and promotion workflows, enforce server-side dashboard session
checks before protected pages render, and remove redundant local Docker script
aliases plus repository-local agent skills.

## 0.2.12 - 2026-08-14

Harden release packaging and keep internal monitoring collection failures out of the public health response.

## 0.2.11 - 2026-08-14

Prevent transient control-plane session failures from crashing dashboard Server Component renders by retrying temporary responses and degrading to the normal session guard.

## 0.2.10 - 2026-08-14

Keep long-running control-plane services recoverable after transient Docker Swarm node or agent interruptions by removing finite restart-attempt limits from the production stack.

## 0.2.9 - 2026-08-12

Allow the cloud instance owner to inspect and trigger managed control-plane updates from the panel while keeping the update surface unavailable to regular cloud users.

## 0.2.8 - 2026-08-12

Make direct IP recovery access resolve to the same-host API, expose complete local topology only to the cloud instance owner, prevent cloud and desktop bare runtimes from reaching local Docker surfaces, and make Desktop default to Upstand Cloud with an explicit local bare-mode opt-in.

## 0.2.7 - 2026-08-12

Hide unavailable Google sign-in, support password setup and passwordless 2FA
for social accounts, preserve CLI device-login URLs on Windows, and refresh
authentication, runtime-channel, release, and self-hosting documentation.

Fix cloud and prefixed self-hosted web runtimes resolving API and documentation links to the wrong origin.

## 0.2.6 - 2026-08-12

Harden runtime-aware authorization across cloud, desktop, and self-hosted control planes. Stored membership permissions are now constrained to their role scope, instance-only operations require interactive owner sessions, cloud-mode policy is resolved consistently, and control-plane transfer requests are bounded. Cloud users can view request observations from their authorized remote servers without exposing control-plane logs, the first workspace is selected reliably after authentication, member role updates use the shared permission catalog, and the web-server settings surface handles configured cloud domains responsively.

## 0.2.5 - 2026-08-11

Restrict cloud control-plane topology, Docker inventory, request logs, local monitoring, control-plane transfer, and local build/deployment settings to their supported runtimes, promote the first cloud account to instance-owner access, and stabilize GitHub manifest setup.

## 0.2.4 - 2026-08-11

Fix Desktop startup fallback and runtime origin probing, and apply the Upstand icon to Windows installers, shortcuts, and windows.

## 0.2.3 - 2026-08-11

Fix packaged Desktop assets and branding, add runtime and connection switching, and keep authentication requests on the active Cloud or self-hosted control plane.

## 0.2.2 - 2026-08-11

Resolve the header documentation link from the browser runtime so immutable images do not render localhost documentation URLs.

## 0.2.1 - 2026-08-11

Fix cloud and prefixed self-hosted web runtimes resolving API and documentation links to the wrong origin.

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
