# Changelog

All notable releases of Upstand are recorded here. Release tags use semantic versioning (`vMAJOR.MINOR.PATCH`).

## Unreleased

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
