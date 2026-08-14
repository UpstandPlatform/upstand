# Upstand Production Readiness Audit — Initial Canary Snapshot

Audit target: synchronized local `canary` at `3b2c4010` (`origin/canary`),
with stable release `v0.2.11` at `d9cf7019` reviewed for release drift. This is
a read-only audit. Remediation was performed afterward on a branch based on
the latest stable release.

## Executive Summary

Initial snapshot verdict: **NOT PRODUCTION READY**.

The application has meaningful security controls, but the repository is not in
a releasable state for paying customers. The current branch is behind the
latest stable release, the full test gate fails in two AI authorization tests,
the dependency audit reports a high-severity `extract-zip` vulnerability, and
the production stack permits scaling single-instance PostgreSQL and Redis
services that use one local volume each. The last item can cause split-brain,
data loss, or queue corruption if operators set the replica variables above
one.

The largest business risks are control-plane data loss, Docker-host compromise
through the mounted Docker socket, unbounded operational blast radius from
stateful-service misconfiguration, and insufficient production observability.

## Remediation Status

The release candidate based on stable `v0.2.11` resolves the concrete release
findings: the vulnerable `extract-zip` path is absent from the lockfile, stable
already contains the bundled stateful-service replica guard, the stable UpGal
tests pass, and the monitoring health endpoint no longer returns internal
collection errors. The candidate also passes the full Bun type/lint/test/build
gates, Go tests, dependency security workflow, and release acceptance
contracts, and is versioned for `v0.2.12`.

Docker socket isolation, deployment-specific observability coverage, and
control-plane disaster-recovery evidence remain operational architecture
requirements that must be verified for each production installation; they are
not represented as silently resolved by this code release.

## Findings

### F-001 — Stable release is not the audited branch

File: `CONTRIBUTING.md` (release workflow); repository refs
Function/Class: release branch synchronization process
Severity: 🟠 Major
Category: Release management / deployment safety

Problem: The local `canary` branch is synchronized with `origin/canary`, but
stable `v0.2.11` is at `origin/master` and is not an ancestor of `canary`.
Stable contains fixes absent from the audit target, including the transient SSR
session-render fix and the Swarm control-plane recovery fix.

Evidence: `git log --left-right canary...v0.2.11` shows `43ac1dac` and
`5f68c89e` only on the stable side; `git show v0.2.11` resolves to
`d9cf7019`.

Impact: A production decision made from `canary` can miss release-only fixes or
approve code that is not the code customers receive.

Recommended Fix: Audit the exact immutable release tag (or merge stable back
into canary through the documented promotion process), then rerun every gate.
Do not force-update the divergent local `master`, which still contains one
unpublished local commit.

### F-002 — High-severity vulnerable `extract-zip` remains in the dependency graph

File: `bun.lock`; `.github/workflows/security-audit.yml:39-40`
Function/Class: desktop build dependency closure
Severity: 🔴 Critical
Category: Supply-chain security

Problem: `bun audit --audit-level=high` reports `extract-zip <=2.0.1` with
`GHSA-jmr9-qjv8-65gv` (unvalidated symlink path traversal). The repository audit
script ignores two `image-size` advisories but does not ignore or remediate this
one.

Evidence: Local audit output reports three high vulnerabilities: two ignored
`image-size` advisories and the unignored `extract-zip` advisory through
`@electron-forge/cli` / `@electron-forge/shared-types`.

Impact: A malicious archive processed by the desktop packaging/tooling path can
write outside its intended extraction directory. Even if the vulnerable code is
build-only, it blocks a clean production supply-chain gate and may affect CI
artifacts.

Recommended Fix: Upgrade or override the transitive package to a patched
release, verify the resulting lockfile and desktop build, and remove the
temporary `image-size` exceptions when patched versions exist. Do not suppress
the `extract-zip` finding without a documented reachability proof.

### F-003 — Production permits unsafe PostgreSQL/Redis replica scaling

File: `docker-compose.prod.yml:37-38`, `docker-compose.prod.yml:108-109`,
`docker-compose.prod.yml:23-24`, `docker-compose.prod.yml:90-91`
Function/Class: `postgres` and `redis` Swarm services
Severity: 🔴 Critical
Category: Database / reliability / scalability

Problem: Both stateful services take replica counts from environment variables,
use `endpoint_mode: dnsrr`, and attach one local volume. PostgreSQL is not made
highly available by starting multiple independent containers; Redis instances
with separate local AOF volumes are likewise not a coherent HA deployment.

Attack Scenario: An operator increases `UPSTAND_BUNDLED_POSTGRES_REPLICAS` or
`UPSTAND_BUNDLED_REDIS_REPLICAS` while scaling the stack. Requests resolve to
different containers with divergent state; writes disappear, sessions/rate
limits diverge, or BullMQ jobs are lost/duplicated.

Impact: Customer data corruption, authentication inconsistency, duplicate
deployments, and unrecoverable control-plane downtime.

Recommended Fix: Hard-code bundled stateful services to one replica and fail
validation if an override is greater than one, or replace them with a real
HA topology with replication, quorum, failover, and tested recovery. Add an
acceptance test that rejects unsafe replica settings.

### F-004 — Docker socket mount gives the application control of the host

File: `docker-compose.prod.yml:257-282`, `docker-compose.prod.yml:362-398`
Function/Class: `server` and `schedules` services
Severity: 🔴 Critical
Category: Container isolation / tenant security

Problem: Both the HTTP control plane and background scheduler mount the host
`/var/run/docker.sock` and can invoke Docker CLI operations. This is effectively
host-root capability from inside either application process.

Attack Scenario: A server-side request vulnerability, compromised dependency,
malicious tenant-controlled deployment input, or scheduler worker compromise
can create a privileged container, mount the host filesystem, read Swarm
secrets, or replace control-plane workloads.

Impact: Full control-plane and host compromise, cross-tenant secret exposure,
service tampering, and potentially compromise of every workload on the node.

Recommended Fix: Move Docker operations behind a narrowly scoped privileged
agent/API with authenticated, capability-specific commands; isolate tenant
workloads onto separate nodes; remove the socket from the public HTTP process;
and enforce an explicit threat model for self-hosted versus cloud mode. Add
negative tests proving tenant input cannot request host mounts or privileged
operations.

### F-005 — Required test gate fails in AI authorization tests

File: `packages/api/src/ai/upgal*.test.ts` and Redis runtime configuration
Function/Class: UpGal capability filtering tests
Severity: 🟠 Major
Category: QA / reliability / CI

Problem: `bun run test` fails two tests after five seconds each:
`excludes get_web_server_logs for non-instance owners` and `excludes
instance-wide Swarm tools for non-instance owners`. The output shows repeated
Redis connection errors and reconnect attempts.

Evidence: Full test command result: 16 packages succeeded, `@upstand/api` had
103 passing and 2 failing tests, and Turbo exited with code 1.

Impact: The production gate is red and the failing authorization coverage is in
the AI control surface. A timeout can also hide a real permission regression.

Recommended Fix: Make these tests use a deterministic in-memory/fake Redis
adapter behind the same interface, or provision a disposable Redis service in
CI. Add an explicit timeout/error assertion so dependency outages fail clearly
instead of hanging at the default five seconds.

### F-006 — Production metrics and alerting cover only the schedules service

File: `ops/observability/prometheus.yml:8-13`,
`ops/observability/upstand-alerts.yml:1-27`
Function/Class: Prometheus scrape and alert rules
Severity: 🟠 Major
Category: Observability / operations

Problem: The checked-in Prometheus configuration scrapes only
`schedules:3002/metrics`. The alert rules shown cover schedules collection,
workers, and database readiness, but there is no configured scrape/alert path
for the server, web, database, Redis, Docker/Swarm, deployment latency, HTTP
errors, queue depth, backup freshness, or disk exhaustion.

Impact: A dead API, failing web service, full PostgreSQL volume, Redis outage,
stuck deployment queue, or silently stale backup can persist until customers
report it.

Recommended Fix: Define service and infrastructure SLOs, scrape all critical
components, add alert routing/notification ownership, and test alert delivery.
Keep `/metrics` private with network policy plus authentication where the
deployment boundary permits it.

### F-007 — No verified control-plane backup and disaster-recovery path

File: `docker-compose.prod.yml:588-592`; release/operations scripts
Function/Class: PostgreSQL and Redis persistence
Severity: 🔴 Critical
Category: Disaster recovery / data durability

Problem: The bundled control-plane database and queue use local Docker volumes.
The repository contains backup/restore rehearsal scripts, but the production
compose file does not define scheduled off-host PostgreSQL backups, encrypted
backup retention, restore verification, or a documented RPO/RTO enforcement
mechanism for the control-plane database.

Impact: Host loss or volume corruption can destroy organizations, sessions,
deployment history, audit logs, encrypted secret metadata, and pending work.
Customer workload backups do not by themselves restore the Upstand control
plane.

Recommended Fix: Implement encrypted, off-host, scheduled control-plane
backups; maintain immutable retention; record backup freshness; run automated
restore drills against disposable infrastructure; and block release/operation
when RPO or restore verification is stale.

### F-008 — Monitoring health endpoint discloses internal error details

File: `apps/monitoring/main.go:55-65`
Function/Class: `GET /health`
Severity: 🟡 Minor
Category: Information disclosure

Problem: The unauthenticated health response returns `collectionError` directly
to any caller.

Attack Scenario: An unauthenticated caller requests `/health` and receives
internal database, filesystem, or callback error text that may include host,
path, or service details.

Impact: Low-grade reconnaissance and possible leakage of infrastructure details
into public monitoring probes or customer-facing proxies.

Recommended Fix: Return only a bounded status and timestamp publicly; log the
full error internally with redaction. Put detailed diagnostics behind an
authenticated/operator-only endpoint.

## Production Readiness Scorecard

| Category | Score /10 | Notes |
|---|---:|---|
| Security | 4 | Strong controls exist, but Docker socket blast radius and dependency gate are blockers. |
| Backend Architecture | 6 | Layering is enforceable, but runtime failure modes remain. |
| Frontend | 6 | No production browser audit was possible without running the deployed app. |
| Database | 3 | Stateful replica configuration and unverified recovery are unacceptable. |
| Infrastructure | 3 | Single-node state and broad Docker privilege create outage/compromise paths. |
| Reliability | 4 | Full tests fail and observability is incomplete. |
| Scalability | 3 | Stateless services can scale, but stateful services and queue capacity do not form HA. |
| Testing | 5 | Broad unit coverage exists, but the required suite is red and no coverage threshold is enforced. |
| Observability | 3 | Checked-in scrape/alert coverage is schedules-only. |
| AI Safety | 5 | Capability tests exist, but their gate is currently failing and provider cost controls need live validation. |

## Security Risk Matrix

| ID | Severity | Risk |
|---|---|---|
| F-002 | Critical | High dependency advisory in desktop closure |
| F-003 | Critical | Unsafe stateful replica scaling |
| F-004 | Critical | Docker socket to public control-plane and worker |
| F-007 | Critical | No verified control-plane DR path |
| F-005 | Major | AI authorization test gate is red |
| F-006 | Major | Critical services are not monitored/alerted |

## Technical Debt Matrix

| Priority | Item |
|---:|---|
| 1 | Replace or isolate Docker socket access |
| 2 | Make bundled stateful services single-replica or implement real HA |
| 3 | Add control-plane backup/restore automation and evidence |
| 4 | Repair deterministic Redis-backed AI authorization tests |
| 5 | Expand metrics, SLOs, alert routing, and operational ownership |
| 6 | Remove dependency audit exceptions after upgrades |

## Scalability Assessment

| Scale | Likely failure mode |
|---|---|
| 100 users | Redis outage causes auth/rate-limit/AI test-like failures; single-node loss is total outage. |
| 1,000 users | Deployment and AI bursts compete for shared queue/Redis and Docker resources. |
| 10,000 users | One control-plane database/Redis instance and local volumes become the primary bottleneck. |
| 100,000 users | Architecture requires externally managed HA database/Redis, sharded queues, and isolated execution planes. |
| 1,000,000 users | Current Swarm control-plane/socket model and single Prometheus target cannot support this scale. |

## Missing Systems Report

1. Off-host encrypted control-plane backups with tested restore and explicit RPO/RTO.
2. Real HA PostgreSQL and Redis or enforced single-replica guardrails.
3. API/web/database/Redis/Swarm SLO metrics and alert routing.
4. Privileged Docker execution broker with capability isolation.
5. Enforced dependency vulnerability remediation/exception expiry.
6. CI Redis service or deterministic adapter for all Redis-dependent tests.
7. Production coverage thresholds and release evidence tied to the exact tag.

## Top 20 Fixes By ROI

1. Make stateful replica variables reject values above one.
2. Fix the two UpGal tests with a deterministic Redis test adapter.
3. Remediate `extract-zip` and rerun `bun audit`.
4. Audit and release from the exact stable tag.
5. Add disk, database, Redis, queue, deployment, and HTTP error alerts.
6. Add backup freshness and restore-rehearsal evidence checks.
7. Remove Docker socket from the HTTP server process.
8. Isolate Docker execution behind a capability-scoped broker.
9. Add CI coverage thresholds for authorization and tenant isolation.
10. Redact detailed monitoring health errors.
11. Add failure-injection tests for Redis and PostgreSQL loss.
12. Add queue saturation and worker lease dashboards.
13. Add database connection-pool saturation metrics.
14. Add release checks that stable tags are ancestors of the audited source.
15. Add immutable backup retention and deletion-policy tests.
16. Add multi-tenant concurrency tests for deployment and secret operations.
17. Add production browser E2E tests for auth, MFA, SSO, and destructive flows.
18. Add Docker/Swarm host-escape regression tests.
19. Add alert delivery integration tests.
20. Document and rehearse regional/host failure recovery.

## Top 10 Production Blockers

1. F-004 Docker socket blast radius is unresolved.
2. F-003 unsafe PostgreSQL/Redis replica configuration is deployable.
3. F-007 control-plane DR is not verified.
4. F-002 high-severity dependency vulnerability remains.
5. F-005 required tests fail in AI authorization code.
6. F-006 critical runtime surfaces lack monitoring and alerting.
7. Stable release and audited branch are not aligned.
8. No demonstrated restore against a fresh production-shaped environment.
9. No demonstrated tenant-isolation/load test at the stated customer scale.
10. No evidence that alert delivery and operator ownership are functional.

## Final Verdict

**Initial snapshot: NOT PRODUCTION READY.**

The initial conclusion was based on observed repository state and command
results, not style preferences. The remediation candidate has since cleared
the repository and release workflow gates; the remaining operational items
above require environment-specific evidence.

## Verification Performed

- `git fetch --all --prune --tags` — passed.
- `canary` fast-forwarded to `origin/canary` — passed.
- `bun run check-types` — passed, 18/18 packages.
- `bun run lint` — passed, 18/18 packages.
- `bun run db:check` — passed.
- `bun run test` — initial canary run failed: 2 UpGal tests timed out; the
  stable remediation candidate passed the full suite.
- `bun audit --audit-level=high` — initial canary run found 3 high advisories;
  the remediation candidate removes `extract-zip` and the repository security
  workflow passes with its two documented `image-size` advisories ignored.
- `git diff --check` — passed.

The documented `TESTING.md` file is absent. The local `master` branch was not
rewritten: it contains one local commit and is divergent from `origin/master`.
