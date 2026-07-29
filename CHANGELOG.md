# Changelog

All notable releases of Upstand are recorded here. Release tags use semantic versioning (`vMAJOR.MINOR.PATCH`).

## Unreleased

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
