# schedules

## 0.2.21

## 0.2.20

## 0.2.19

## 0.2.18

## 0.2.17

### Patch Changes

- [#290](https://github.com/UpstandPlatform/upstand/pull/290) [`13dc591`](https://github.com/UpstandPlatform/upstand/commit/13dc591ad4d1161e462d6d32cc318e0525b9426c) Thanks [@mhbdev](https://github.com/mhbdev)! - Harden container file management around explicitly selected full container IDs and named Docker volumes. File operations are now mount-scoped, symlink-safe, bounded, binary-safe, atomic for writes, and reject read-only or non-canonical targets. The release also removes runtime compatibility paths that accepted legacy labels, plaintext secret documents, abbreviated container IDs, legacy installer artifacts, and non-paginated backup adapters.

## 0.2.16

## 0.2.15

### Patch Changes

- [#286](https://github.com/UpstandPlatform/upstand/pull/286) [`ea7d678`](https://github.com/UpstandPlatform/upstand/commit/ea7d678185fceb73efcdb0eda5498e042471d6a1) Thanks [@mhbdev](https://github.com/mhbdev)! - Make local self-hosted and cloud development runtimes safely switchable with isolated persistent state, and add a disposable Multipass remote-server lab for end-to-end provisioning tests.

## 0.2.14

## 0.2.13

## 0.2.12

## 0.2.11

## 0.2.10

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

## 0.2.5

## 0.2.4

## 0.2.3

## 0.2.2

## 0.2.1

## 0.2.0

### Minor Changes

- [#227](https://github.com/UpstandPlatform/upstand/pull/227) [`d0afa63`](https://github.com/UpstandPlatform/upstand/commit/d0afa639de1a1c2cca58410947d43057a91927c6) Thanks [@mhbdev](https://github.com/mhbdev)! - Add production deployment plans and capability policy, resumable workload and control-plane migration workflows, portable encrypted transfers, correlated operational telemetry, GitHub diagnostics, operator runbooks, and matching dashboard and CLI controls.

## 0.1.55

## 0.1.54

## 0.1.53

## 0.1.52

## 0.1.51

## 0.1.50

## 0.1.49

## 0.1.48

## 0.1.47

## 0.1.46

## 0.1.45

## 0.1.44

## 0.1.43

## 0.1.42

## 0.1.41

## 0.1.40

## 0.1.39

## 0.1.38

## 0.1.37

## 0.1.36

## 0.1.35

### Patch Changes

- Patch release for the production dependency security update.

## 0.1.34

## 0.1.33

## 0.1.32

### Patch Changes

- Release 0.1.32 setting up Docker Buildx before logging in to GHCR in pre-release-acceptance job.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.31

### Patch Changes

- Release 0.1.31 adding desktop payload builds for server and web before running electron-forge make in release workflow.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.30

### Patch Changes

- Release 0.1.30 fixing metadataBase fallback URL in fumadocs and skipping nested node_modules during desktop payload staging.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.29

### Patch Changes

- Release 0.1.29 fixing step-level env evaluation for BACKUP_REHEARSAL_LOG in release workflow.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.28

### Patch Changes

- Release 0.1.28 ensuring BACKUP_REHEARSAL_LOG and ACCEPTANCE_EVIDENCE_DIR are defined in release workflow job env.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.27

### Patch Changes

- Release 0.1.27 ensuring all shell scripts have executable permissions.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.26

### Patch Changes

- Release 0.1.26 supporting explicit zero latency limits in health-load-rehearsal script.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.25

### Patch Changes

- Release 0.1.25 fixing latency budget test threshold in health-load-rehearsal test script.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.24

### Patch Changes

- Release 0.1.24 adding @upstand/env to root devDependencies.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.23

### Patch Changes

- Release 0.1.23 with high-level audit filter for dependency security checks.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.22

### Patch Changes

- Release 0.1.22 removing unused env import from drizzle.config.ts.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.21

### Patch Changes

- Release 0.1.21 removing unused env import from drizzle.config.ts.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.20

### Patch Changes

- Release 0.1.20 decoupling drizzle.config.ts from server runtime environment validation.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.19

### Patch Changes

- Release 0.1.19 with job-level release workflow environment variables fix.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.18

### Patch Changes

- Release 0.1.18 with job-level environment variables fix for db verification step.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.17

### Patch Changes

- Release 0.1.17 with release workflow environment variables fix and verified server assignment logic.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.16

### Patch Changes

- Release 0.1.16 with release workflow environment variables fix and verified server assignment logic.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.15

### Patch Changes

- Release 0.1.15 with clean lockfile and verified server assignment logic.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.14

### Patch Changes

- Release 0.1.14 with clean lockfile and verified server assignment logic.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.13

### Patch Changes

- Release 0.1.13 with clean lockfile and verified server assignment logic.

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.12

### Patch Changes

- [#82](https://github.com/UpstandPlatform/upstand/pull/82) [`1504e93`](https://github.com/UpstandPlatform/upstand/commit/1504e9391bfd05dd38a96de8009c722bd0190265) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.12 with clean lockfile and verified server assignment logic.

- [#76](https://github.com/UpstandPlatform/upstand/pull/76) [`b9a11bc`](https://github.com/UpstandPlatform/upstand/commit/b9a11bc1bc40bd09c2376674b473a7daef438beb) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.11

### Patch Changes

- [#73](https://github.com/UpstandPlatform/upstand/pull/73) [`a7c91f5`](https://github.com/UpstandPlatform/upstand/commit/a7c91f57bedf1154ee8b6a5bddff25285b71e594) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.10

### Patch Changes

- [#71](https://github.com/UpstandPlatform/upstand/pull/71) [`453d05f`](https://github.com/UpstandPlatform/upstand/commit/453d05ff14929753a9a8b3c7f1d32c0b8208a895) Thanks [@mhbdev](https://github.com/mhbdev)! - Release 0.1.10 patch update with clean Bun lockfile and updated GitHub Actions workflows.

## 0.1.9

### Patch Changes

- [#58](https://github.com/UpstandPlatform/upstand/pull/58) [`bc02bb2`](https://github.com/UpstandPlatform/upstand/commit/bc02bb26eb7fa81fb70c74fc84ea10b7bbe46009) Thanks [@mhbdev](https://github.com/mhbdev)! - Harden production tenancy boundaries, including AI deployment-history scoping, API-key organization binding, bounded SQL-backed global search projections, tenant-scoped SQL resource ID projections, metadata-only environment listing without secret hydration, a dedicated recent-2FA environment secret capability, bounded repository reads and AI conversation history, read-time encryption upgrades for legacy resource and environment secret rows, secret-free Caddy routing projections, success-only preview routing projections, non-secret autoscaling projections, credential-free scheduled Docker cleanup discovery, batched and bounded queue/history resource summaries and deployment labels, S3 destination update authorization, instance-wide Swarm access, local Docker inventory/control access, container/volume upload authorization, privileged database command authorization, outbound endpoint policy, Caddy forward-auth SSRF protection, webhook delivery, GitHub App manifest callbacks, backup organization and certificate referential integrity, deployment migration ownership checks, pending-invite SSO enforcement, server-scoped routing reconciliation, bounded Redis operations, bounded tenant topology reads, bounded Docker metrics collection, remote monitoring Docker-socket group propagation, AI usage limits and MCP request deadlines, backup execution, queue observability, migration and startup safety, serialized self-updates, terminal sessions, readiness probes, encrypted local parity networking, custom network propagation, Swarm-compatible non-root runtime identity, Swarm-effective container hardening, installer encrypted-network runtime probing, bounded installer downloads, bounded archive extraction processes, bounded privileged Docker archive validation, runtime acceptance verification including task-container health coverage, deployment image revisioning, release image manifest verification and pinning, explicit audited release-tag installation, installer persistence and validation of security/operations configuration, stateful database entrypoint capability minimization, browser replay-memory bounds, Mermaid SVG sanitization, safe browser handling of catalog and provider URLs, cursor-paged backup retention and schedule cleanup, production acceptance network-attachment and monitoring-image checks, routable release Swarm initialization, bundled and external-data HA release acceptance rehearsals with a contract guard, production build verification, Chromium/Firefox/WebKit public browser smoke coverage, deduplicated schedules operational alerts for Redis, queues, outbox, and backup freshness, production documentation that routes operators through the audited installer instead of an unsafe mutable-tag Compose quickstart, generated authentication for managed databases with fail-closed deployment when legacy resources have no credentials, and a pinned libSQL managed-database image default.

- [#58](https://github.com/UpstandPlatform/upstand/pull/58) [`bc02bb2`](https://github.com/UpstandPlatform/upstand/commit/bc02bb26eb7fa81fb70c74fc84ea10b7bbe46009) Thanks [@mhbdev](https://github.com/mhbdev)! - Harden production authorization, secret isolation, public endpoint admission controls, scheduler execution, AI/MCP limits, and stateless container security.

## 0.1.8

### Patch Changes

- [#55](https://github.com/UpstandPlatform/upstand/pull/55) [`36c6edc`](https://github.com/UpstandPlatform/upstand/commit/36c6edc654ea3ee80f6e3e019496b616c8bd2fde) Thanks [@mhbdev](https://github.com/mhbdev)! - Promote the corrected desktop installer fix as the next Upstand platform patch release.

## 0.1.7

## 0.1.6

### Patch Changes

- [#41](https://github.com/UpstandPlatform/upstand/pull/41) [`1538533`](https://github.com/UpstandPlatform/upstand/commit/153853318546c72cfd32a0aad8aebd759e0636d7) Thanks [@mhbdev](https://github.com/mhbdev)! - Harden tenant isolation, authentication, external network access, archive uploads, and secret-provider workflows.

  Improve audit-log pagination and search, bound external response bodies, parallelize topology discovery, and reduce unnecessary dashboard loading and reconciliation work.

- [#25](https://github.com/UpstandPlatform/upstand/pull/25) [`c914636`](https://github.com/UpstandPlatform/upstand/commit/c914636414f7fd102703525eb62433bae5434483) Thanks [@dependabot](https://github.com/apps/dependabot)! - chore(deps): update production dependencies via Dependabot ([#25](https://github.com/UpstandPlatform/upstand/issues/25)).

## 0.1.5

## 0.1.4

## 0.1.3

## 0.1.2

### Patch Changes

- [#17](https://github.com/UpstandPlatform/upstand/pull/17) [`5f71f61`](https://github.com/UpstandPlatform/upstand/commit/5f71f619ed6ebb6ef22c7fcd92b5c16792999014) Thanks [@mhbdev](https://github.com/mhbdev)! - Make source-based installations resilient when the Go module proxy returns a temporary or policy-based HTTP error.

## 0.1.1

### Patch Changes

- [#4](https://github.com/UpstandPlatform/upstand/pull/4) [`eda5065`](https://github.com/UpstandPlatform/upstand/commit/eda5065d8e8303033653fdf1d33e09f22b4c5f0c) Thanks [@mhbdev](https://github.com/mhbdev)! - Improve topology visibility, terminal workflows, authorization behavior, and local development verification across the Upstand applications.
