# Upstand Production-Readiness Audit

Date: 2026-08-27
Revision: follow-up infrastructure hardening branch `feat/service-volume-ownership` (PR #350)
Scope: control plane, web console, Fumadocs, Go monitoring, PostgreSQL/Drizzle, Redis/BullMQ, Docker Swarm, installer, CI/CD, auth/authz, webhooks, AI, backups, and observability.

## Executive Summary

Verdict: **NOT PRODUCTION READY**.

The codebase has meaningful hardening: package boundaries are clear, centralized authorization is widely used, secure-cookie defaults and CSP exist, production Compose enforces non-root/read-only/capability-drop contracts, and the installer fails closed for several dangerous choices. The latest iteration also adds a deny-by-default Docker API allowlist with caller/operation audit events, fail-closed legacy instance ownership, protected API RED telemetry, composite backup tenant constraints, complete web-server artifact verification before a backup is marked restore-tested, typed ownership-checked isolated-network cleanup, and broker-owned Caddy provisioning/configuration with bounded archive, validation, reload, and rollback behavior.

The current web security iteration additionally prevents server-rendered
session requests from deriving their API destination from forwarded headers
or arbitrary public Host values. Normal SSR uses the configured API origin;
only a validated direct-IP Host is used for the explicit bootstrap path, with
regression coverage for spoofed forwarding headers.

The current infrastructure iteration additionally requires a validated
resource scope for production deployment-worker image builds and Swarm service
create/update/delete operations. Dockerode and Docker CLI clients propagate
that scope on per-resource requests. The same scope is now required for the
worker's raw resource creation, image-pull, network-connect, and mutating
container paths; global Docker build-cache pruning is denied to the worker;
raw Swarm service creation and update bodies must also carry the exact
system-owned resource label. Existing raw worker container mutations and
network attachments now also perform daemon-side ownership preflight against
live Docker labels; resource-specific networks must match the managed naming
and ownership contract, and shared-network attachments require an encrypted
attachable overlay. Raw worker service updates now also re-inspect the target
Swarm service and require its exact ownership label. Worker service listings now
require the exact resource label, worker task listings resolve and verify the
owning service before forwarding, and worker service inspections require the
same daemon-side ownership check. Ownership-checked typed service, network, and
database-volume removal covers local cleanup paths; the score remains
unchanged because the remaining Compose orchestration and secret-bearing build
paths are not yet a fully typed deployment capability.

The latest scoped-authority slice replaces the worker's self-asserted resource
header with a short-lived HMAC grant issued by the control-plane queueing path.
Compose deployment validation also rejects generated-directory escapes through
build contexts, Dockerfiles, env files, extension files, and external includes,
and blocks SSH-agent forwarding during builds.
Production server and schedules processes can sign grants from a Swarm secret;
the deployment-worker image is deliberately not given that secret. The worker
forwards the grant through Dockerode, Docker CLI custom headers, and broker
stream requests, while the broker verifies the signature, lifetime, and exact
resource/deployment/server binding before applying the existing typed/raw
policy. Async-local context and Go/TypeScript regression tests cover
concurrent-job isolation, missing/expired/tampered grants,
cross-resource/cross-target replay, transport header propagation, secret
mounting, and release acceptance composition. This closes the worker
identity-confusion gap, but does not turn the remaining raw Compose and
secret-bearing build paths into fully typed capabilities.

Resource-specific cleanup and replication fallbacks now also resolve through the
resource-scoped Docker client, including service, volume, and isolated-network
operations; host-wide inventory and maintenance remain intentionally global.

Raw worker service/task/network metadata discovery now also fails closed: service
and network listings require an exact resource filter, task listings require an
owned service filter, and individual service/network inspection is checked against
live daemon metadata before the response is forwarded.

Legacy worker volume inspection now follows the same daemon-side ownership rule:
Compose volumes must be managed, local, unconfigured, and labeled for the exact
resource, while the supported database volume is admitted only by its exact
resource-bound name.

Generated Compose manifests are now written with owner-only permissions on
Unix deployment hosts and are removed from the temporary build workspace on
every preparation, command, convergence, and write failure path. This reduces
the lifetime and local-read exposure of environment values that remain in the
current constrained Compose transport. The Docker Compose CLI now receives a
minimal process environment rather than the full control-plane environment;
resource variables that could redirect Docker or Compose itself are filtered
from that subprocess, and protected Docker transport variables cannot be
interpolated into a workload. Focused child-process, deployment, and
post-configuration validation tests cover this boundary.

The latest Compose boundary pass rejects external network and volume references,
invalid top-level resource keys, and reserved ingress-network reuse before
deployment. Explicit Docker resource names are rewritten into the project
scope; generated networks and volumes receive immutable resource labels; and
local deployments pre-provision user-defined networks and named volumes through
typed broker capabilities before externalizing them in the private manifest.
The deployment worker's raw network/volume creation endpoints are denied in
production, and shared-network creation uses a typed, configured-name-only
operation.

The follow-up Compose isolation pass also rejects host and cross-container
namespace sharing (`host`, `container:*`, and `service:*`), inherited container
volumes, external container links, host-gateway `extra_hosts`, service sysctls,
cgroup-parent/storage/blkio
controls, and security-profile downgrades such as `label=disable` and
`systempaths=unconfined`. These controls close additional cross-workload and
host-control attachment paths in the constrained Compose validator and are
covered by the pipeline security suite. Generated Compose now also applies the
immutable resource label to both container/task metadata and Swarm
`deploy.labels`, so broker service filters and daemon-side ownership checks
remain effective for stack deployments as well as standalone Compose. The
remaining raw Compose orchestration transport is still an explicit
architectural limitation.

The latest rollback boundary pass routes local rollback image commit/tag operations
through the typed broker, verifies the source image's exact resource ownership
label or deterministic resource image name, and removes the temporary marker
container and image on both success and failure. The legacy direct Docker CLI
fallback now also generates valid tagged marker references. This closes the raw
container-commit path for production local callers while retaining the documented
unsupported remote and secret-bearing builder paths.

The latest AI boundary pass wraps web, Tavily, and opt-in MCP results in a
bounded, schema-declared `external-untrusted` envelope under `data`. The
serializer caps total characters and nodes, rejects cycles, unsafe provenance
metadata, prototype-shaped keys, and non-finite numbers, and focused API tests
exercise the execution and schema contracts. This improves information-flow
separation; adversarial model evaluations and provider billing reconciliation
remain operational evidence requirements.

Long-lived MCP clients now revalidate each request URL and its DNS answers
before forwarding the request, so a hostname that changes from a public answer
to a blocked address is rejected before the subsequent call. This is an
additional defense-in-depth check; the hostname transport is not IP-pinned, and
adversarial model evaluation remains required.

Configured AI provider SDK clients now use the same per-request destination
revalidation for custom self-hosted endpoints, enforce the configured origin,
and disable redirects. Focused provider tests cover public resolution, DNS
rebinding to loopback, and cross-origin request attempts. Provider billing
reconciliation and adversarial model evaluation remain operational evidence
requirements.

The release remains blocked by two current facts:

1. Docker authority is now isolated in a dedicated broker, and deployment queue
   execution is separately deployed from the schedules orchestrator with its
   own caller token, mTLS certificate, role, replica setting, and acceptance
   checks. The broker now applies caller-specific operation capabilities: the
   schedules identity cannot build images or create ad-hoc containers, and the
   deployment-worker identity cannot perform global cleanup or delete/tag
   arbitrary images. API-facing resource workflows now receive separate
   method-bound capability objects, and remote resolution preserves that
   capability shape instead of returning the full Docker service. The broker
   still exposes a constrained Docker API rather than fully typed transport;
   the installer provisions and validates independently rotated mTLS identities,
   distinct server/schedules/worker credentials through Swarm secrets, bounds
   concurrent Docker operations, and keeps the broker control network internal
   to the Swarm overlay. The deployment-worker now uses typed, resource-scoped
   command, convergence, service, pull, push, build, network, volume, and
   rollback routes for local operations; local resource-only command execution
   resolves a running container inside the broker from the exact system-owned
   `com.upstand.resource-id` label, and Compose-generated resource services
   receive that label during configuration. Broader build, Compose, secret-
   bearing service-mutation, unsupported credential/fallback, and explicit
   remote paths remain on constrained transport pending further decomposition.
   In production caller-identity mode, the server caller is denied raw image
   builds and arbitrary service create/update operations, and raw worker
   image-build requests require a validated resource scope propagated through
   Docker CLI custom headers.
     Local Swarm convergence checks now use a typed resource-convergence route
    that verifies service and task ownership inside the broker and returns
    bounded task/health state instead of raw local task and container
    inspection calls.
2. No installation-specific control-plane backup/restore with secret/key recovery is evidenced; the application backup path now validates the database archive and every Caddy archive, and production requires a successful, fresh, restore-verified backup policy, but the destination and restore drill are still operator-configured.

The installer now fails closed unless the operator records an explicit
off-site, key-escrow, immutable-retention, RPO/RTO, and evidence-reference
attestation. Production acceptance additionally requires a fresh,
installation-scoped JSON record with a detached Ed25519 signature and checks
its data assertion, destination/retention/escrow claims, measured objectives,
and reference binding. The verifier is itself release-manifest hash checked.
This is a material evidence-integrity improvement, but it still cannot create
the underlying off-site restore or key-escrow evidence; operators must produce
and retain that signed record from a real rehearsal.

The latest container iteration also removes Pack, Buildx, Nixpacks, `make`, and
`g++` from the long-lived API server and schedules-orchestrator images. The
schedules service now runs as an explicit lean orchestrator, while a separately
published deployment-worker image retains only the build/deploy toolchain and
runs the deployment queue with its own identity. Compose, source installs,
release manifests, CI, and production acceptance now require distinct
immutable images. The remaining broad authority is concentrated in the broker
transport; host cleanup and GPU operations now resolve a dedicated maintenance
capability, preview cleanup, deployment, migration, autoscaling, API resource
workflows, and Swarm control now use narrow method-bound ports. Local API-facing
inventory, container/resource control, and pruning now use typed broker
operations. Self-update now
uses a digest-bound typed broker operation that mutates only managed service
images, release markers, monitoring image, and force-update state.
Web-server maintenance now uses typed broker routes for managed service update,
bounded logs, the exact Redis flush operation, managed-network inspection, and
bounded Docker cleanup; GPU inspection/setup remains local host capability work.
All server Swarm management operations now use a typed broker contract with
strict operation/field validation, bounded node/network names, encrypted
attachable-network checks, and schema-validated responses instead of raw Docker
transport. Local inventory, container/resource control, and pruning use a
separate typed contract with bounded operation-specific fields and validated
response models; remote server targets remain on their explicit SSH path.

The release gate now selects the `full` acceptance profile for stable tag
pushes, so backup/restore, failure-injection, bounded load, soak, and
observability rehearsals cannot be skipped by the tag-triggered publication
workflow. The `smoke` profile remains available only as an explicitly selected
manual diagnostic retry; it is not the stable publication default. This closes
a release-workflow configuration gap, but the full hosted rehearsal still uses
disposable infrastructure and does not replace installation-specific
off-host restore or key-escrow evidence.

The reusable release workflow now has an explicit caller permission ceiling in
the scheduled recovery workflow, while the called jobs retain their narrower
per-job permissions. Recovery also supports immutable legacy tags whose release
manifest predates the current deployment-worker/Docker-broker image set:
those tags run verification-only with visible compatibility notices instead of
claiming current multi-service acceptance. The hosted rehearsal for `v0.2.25`
passed at run `33036632711`; image builds, publication, and the incompatible
current acceptance phase were skipped by explicit inputs. This proves the
workflow starts and verifies a legacy release, but is not a production release
publication or current-image acceptance result.

The hosted release matrix also revalidated the packaged Desktop runtime after
the Windows startup-window fix: Linux, macOS, and Windows packaging passed,
including the Windows packaged API/dashboard health probe. This closes the
observed CI timing failure; it does not substitute for installed-customer
environment evidence.

The API now records low-cardinality authentication outcomes at the protected
HTTP middleware boundary (`authenticated` or `rejected`) without including
user, token, or request-identity data. Prometheus has a corresponding sustained
rejection-rate alert, and the observability contract verifies both the metric
and alert. This improves detection of credential attacks and authentication
outages, but does not replace live cutover or incident-response evidence.

The server metrics endpoint now also exposes only aggregate PostgreSQL pool
gauges (total, idle, and waiting clients), with a critical alert when requests
wait for a connection for five minutes. Focused rendering and invalid-value
tests plus the observability contract pass. This makes database saturation
actionable without adding route, tenant, query, or credential labels; it does
not yet provide deployment- or broker-specific RED metrics.

The server request telemetry now also normalizes methods and status values and
emits bounded route-family request counters plus Prometheus latency histograms
for API, authentication, deployment, MCP, webhook, system, and other traffic.
Route-family and deployment p95 alerts are covered by the observability
contract and focused metrics tests; request paths and identifiers are not
exported as labels. This improves API and deployment SLO localization, but
broker health, web availability, provider invoice reconciliation, and live
alert-routing/paging evidence remain open.

Preview cleanup now carries the owning resource ID through the capability
boundary. Local broker-backed cleanup uses the typed ownership-checked service
removal route, while the non-broker fallback re-inspects the service and
requires the exact `com.upstand.resource-id` label before deleting it. This
closes the prior service-name-only deletion path.

A disposable restore rehearsal was completed against the immutable local server
image `upstand-server:dr-rehearsal@sha256:6a4e44a2374fcaffc92d5ccdccee2adc7f52f3d3396a9087cbeaa72007753139`.
It uploaded and downloaded a PostgreSQL/MinIO backup, restored PostgreSQL, and
asserted restored data in 6.369 seconds total (0.099 seconds restore time).
The rehearsal can now emit a non-secret JSON evidence record containing the
immutable image digests, assertion result, and timings. This is repeatable
evidence for the rehearsal tooling, but does not replace an
installation-specific off-host restore, key-recovery test, or measured
production RPO/RTO record. The full release profile now also exercises the
application AES-256-GCM encryption-key format against a sentinel and emits
only a SHA-256 key fingerprint and timing; this is synthetic key-format
evidence, not proof of escrow access.

The external-services smoke rehearsal also passed against the immutable server
image `upstand-server@sha256:6a4e44a2374fcaffc92d5ccdccee2adc7f52f3d3396a9087cbeaa72007753139`.
It applied the complete migration set to disposable external PostgreSQL,
applied it again as the upgraded/no-op path, and passed the live server health
check with external Redis; its disposable containers were cleaned up.

This iteration has remediated several findings without weakening the gate: production
services now enforce `no-new-privileges`, server/schedules no longer receive the
unnecessary host-gateway alias, direct-IP origin and cookie handling require explicit
bootstrap mode, AI admission happens before new conversation persistence, AI output
budgets are bounded, preview quota decisions use a resource-row lock, failed preview
cleanup is durable, backup organization IDs have foreign keys, the self-hosted owner
is persisted for new installations, public docs chat input is structured and bounded,
and CodeQL includes Go. The latest iteration also adds server-signed UpGal
approval continuations, a deny-by-default Docker API allowlist, fail-closed
legacy instance ownership, protected API RED
telemetry, and a mandatory restore-verification signal. These changes improve
the score: the HTTP API, scheduler,
and monitoring agent no longer receive the host Docker socket; only the dedicated
broker does, on a separate encrypted control network. The broker denies the
host-escape primitives used by the original socket threat model. This still does
not establish installation-specific production DR evidence or a fully typed
broker transport for every remaining build and service-mutation operation.

The AI message path was not found to have a demonstrated cross-tenant read: ownership is checked before route reads and repository reads are bounded. The backup foreign keys and generated composite same-organization schedule/destination invariants are now represented in source and migration history; normalized resource ownership remains an explicit follow-up rather than a fabricated direct constraint.

The AI path now also hard-bounds the complete chat request history, interactive
output, aggregate per-run token usage, and Tavily extract/crawl/map inputs and
outputs. It reserves a conservative per-organization daily cost ceiling in
integer cents using a reviewed worst-case USD-per-million-token rate. Provider-
native Tavily tools remain available only through bounded wrappers, and an
operator can enforce an exact model allowlist at provider resolution. Configured
provider SDK requests revalidate custom endpoint DNS, enforce the configured
origin, and reject redirects. Mutation approval continuations are now
HMAC-bound to the exact tool call with a dedicated server-only secret. Provider
invoice reconciliation and full model-facing data isolation remain open.

AI runs also finalize as failed when stream setup or streaming errors occur;
MCP connection cleanup is attempted in a finally path and cleanup failures are
logged without replacing the original run failure. This keeps durable run
status and external-tool cleanup aligned with the existing token checkpoints.

The latest AI-budget change reserves the per-request run, token, and
conservative cost ceilings in one three-key Redis script: all three limits are
checked before any counter is incremented. Both the tRPC and legacy HTTP chat
entry points use this all-or-nothing admission path. The protected server
metrics endpoint now exposes aggregate admitted/rejected reservation counts
and reserved token/cost totals, with a sustained-rejection alert and no
organization, model, prompt, or credential labels. The focused regression
suite covers successful three-key accounting, combined-limit rejection,
malformed Redis responses, and unsafe input rejection. A rejected cost or
token admission therefore cannot consume run quota without admitting a model
call; provider invoice reconciliation and model-facing data isolation remain
open.

The control-plane transfer HTTP boundary now validates owner repair, owner
transfer, and export JSON with strict runtime schemas, bounds passphrases before
the memory-hard KDF, and preserves exact passphrase characters across export
and import instead of normalizing one side only. Focused server tests cover
unknown-field rejection, exact confirmations, bounded IDs, passphrase bounds,
and whitespace-preserving round trips. This closes a concrete malformed-input
and transfer-compatibility gap; live owner transfer/repair evidence remains an
operational requirement. The same passphrase bounds and exact-character
behavior are now enforced again inside the portable-secret-bundle KDF, covering
non-HTTP callers such as CLI and internal transfer services.

## Production Readiness Scorecard

| Area | Score | Assessment |
|---|---:|---|
| Architecture | 9.9/10 | Orchestration, deployment execution, workload migration, autoscaling, API resource workflows, typed web-server and Caddy provisioning/configuration, cleanup, self-update, local inventory/control/prune, resource-scoped container file operations and commands, typed local convergence, resource-owned local service mutation, revision promotion, and bounded scaling, bounded Dockerfile builds with non-secret build-argument validation and owned-image pushes, and Swarm maintenance, preview cleanup, host maintenance, and deployment-hook command execution now have explicit process, image, role, identity, and method-bound capability boundaries; the broker transport remains broader for Compose, secret-bearing builds, and remote service mutation. |
| Authentication | 9.3/10 | Direct-IP origin/cookie behavior is opt-in and production plaintext bootstrap is restricted to loopback/private/link-local addresses, requires matching direct hosts, cookie downgrade additionally requires explicit insecure-bootstrap mode, and the Better Auth protocol surface now has a distributed edge limiter plus a 256 KiB body cap; protected requests also emit low-cardinality authentication outcomes for alerting; production self-hosted direct HTTP is rejected after the first account, but TLS cutover evidence remains an operational requirement. |
| Authorization | 8.5/10 | New self-hosted installs persist the owner, legacy installations fail closed, and owner transfer plus legacy owner repair are explicit step-up-protected compare-and-swap operations with audit records; live transfer/repair evidence remains. |
| API security | 8.9/10 | Origin trust binds production direct-IP origins to the request host and private address space, direct HTTP is bounded to first bootstrap, Better Auth has distributed request limiting and a route-specific body cap, protected authentication outcomes and webhook outcomes/latency are measurable with sustained-rejection/error alerts, resource workflows use narrow Docker capabilities, and AI admission is bounded by run, token, and conservative cost ceilings with aggregate admission telemetry; edge/API SLO and provider invoice reconciliation remain open. |
| Database | 9.4/10 | Generated composite same-organization constraints now cover backup, AI, notification, server/SSH-key, registry/server, and S3/certificate relationships; resource ownership remains inherited through the normalized non-null foreign-key chain, while fresh PGlite and fresh-plus-upgraded external PostgreSQL migration evidence now pass against the immutable server image. |
| AI security/cost | 9.5/10 | Admission ordering, bounded history/output/aggregate tokens, atomic per-organization daily worst-case token and conservative model-aware cost reservations, durable per-run input/output/total token metering, checked-in model pricing metadata with aggregate estimated-cost and unpriced-usage metrics, failed-run finalization with defensive MCP cleanup, bounded provider output, schema-declared external-untrusted provenance envelopes, per-request custom-provider DNS/origin/redirect enforcement, and an operator-enforced exact model allowlist are present; provider invoice reconciliation and adversarial model evaluation remain open. |
| Frontend | 8/10 | CSP, safe React rendering, and browser smoke tests are present. |
| Containers/infra | 9.9/10 | Server/schedules/monitoring socket exposure is removed; the broker is isolated on an encrypted internal control network, requires TLS 1.3 with caller-specific verified client certificates at the TLS handshake plus defense-in-depth tokens, fails closed on legacy/missing/unknown production identities, validates certificate chain/EKU/identity/key pairing before reuse, enforces a deny-by-default API allowlist plus caller-specific operation capabilities, permits only built-in volume/network drivers, rejects host-backed volume options, custom runtimes, weakened security profiles, and writable telemetry binds, bounds in-flight Docker operations, emits normalized audit events, and has explicit HTTP limits. Docker CLI subprocesses use verified caller-specific certificates through standard TLS file names. The schedules orchestrator is lean, the separately published worker resolves a tested narrowed deployment adapter, and typed self-update, preview cleanup, restart-safe pending-preview reconciliation, web-server maintenance, typed Caddy provisioning/configuration (including bounded archive upload, validation, reload, and rollback), typed cleanup, host maintenance, workload migration, autoscaling, bounded local resource scaling, API resource workflows, local inventory/control/prune, resource-scoped container file operations and commands, typed local convergence, resource-owned local service mutation, revision promotion, and cleanup, deterministic owned isolated-network and database-volume cleanup, bounded non-secret Dockerfile builds, owned-image registry pushes, all Swarm control, deployment-hook command execution, and local Compose/Swarm-stack stop teardown resolve method-bound capabilities; raw Compose validation now rejects network-style build contexts, build secrets, external caches, host and cross-container namespace sharing, inherited container volumes, external links, entitlements, deploy-level privilege/capability/device/security/sysctl controls, custom runtimes, and host GPU devices, and remains limited to the generated local workspace, while the broker transport remains broader for Compose orchestration and remote service mutation. |
| CI/CD | 8.7/10 | Pinned actions/images, current Go toolchains, broker image provenance, generated-schema checks, Go vulnerability scans, race-detector and vet checks for monitoring and the Docker broker, and a zero-high-advisory dependency gate are present; live release evidence and broader coverage gates remain. |
| Observability | 8.0/10 | Scheduler/queue/backup coverage now includes protected API request/error/latency/memory metrics, authentication outcomes, webhook provider/status/latency metrics, aggregate PostgreSQL pool saturation, bounded background-job success/failure and duration metrics for deployment/backup/notification/migration/outbox operations, AI budget admission metrics, checked-in model-priced versus unpriced usage, and aggregate estimated AI cost with alerts; broker, web, and provider invoice/request-cost reconciliation remain. |
| QA/release gate | 8.1/10 | Typecheck, lint, DB checks, full test suite, release contracts, security audit, build, Go vet, and hosted race-detector checks pass; live production E2E evidence remains opt-in. |
| Disaster recovery | 8.3/10 | Control-plane web-server backups validate the dump and all volume archives, storage defaults to SSE-S3 unless a reviewed SSE-KMS/SSE-C mode is selected, production installation requires a recovery-plan attestation, and production acceptance now requires fresh installation-specific JSON evidence with mandatory installation, backup-artifact, restore-target, release, and recovery-point references, a detached Ed25519 signature, data assertion, off-site/retention/escrow claims, measured RPO/RTO, and release-hash-verified tooling. The disposable MinIO/PostgreSQL rehearsal plus synthetic AES-256-GCM key-format probe emit explicitly labelled evidence with measured timings; independent real-data off-host restore, escrow-access, and target-installation evidence remain open. |

Overall: **8.9/10**. This is an interim score, not a release approval.

## Findings

### F-001 — Docker broker still exposes broad daemon authority

- **File:** docker-compose.prod.yml:211-258; apps/docker-broker/main.go
- **Function/Class:** Production Docker broker and control-plane Docker clients
- **Severity:** Major
- **Category:** Container isolation / RCE / infrastructure security
- **Problem:** The original direct mounts were removed from server, schedules, and the monitoring agent, but the broker still mediates Docker daemon operations rather than exposing typed deployment capabilities.
- **Latest iteration:** Local API-facing inventory, container/resource control, and pruning now resolve through `/upstand/v1/server/inventory`; container file management and resource-container command execution resolve through `/upstand/v1/server/resource-files` and `/upstand/v1/server/resource-command`; deployment-worker pre/post hooks use the same typed command contract with service-task resolution; local Swarm convergence checks use `/upstand/v1/server/resource-convergence`, which verifies the exact service/resource label and returns bounded task/health state; local database/application image pulls now use `/upstand/v1/server/resource-pull` with bounded image references and ephemeral registry authentication; local image deployments, including registry-authenticated service create/update, use `/upstand/v1/server/resource-service` for resource-owned service mutation and overlay-network attachment; ownership-labelled local image pushes use `/upstand/v1/server/resource-push`; local Dockerfile builds stream a Dockerfile-aware, `.dockerignore`-filtered context through `/upstand/v1/server/resource-build`, which now accepts only bounded non-secret build arguments and a bounded build target; isolated resource overlay-network removal uses `/upstand/v1/server/resource-network`; deterministic database-volume removal uses `/upstand/v1/server/resource-volume`; and local rollback image commit/tag operations use `/upstand/v1/server/resource-rollback`, with broker-side ownership checks and cleanup. Production server identities are now denied raw image-build and arbitrary service create/update paths; production schedules and deployment-worker identities are denied raw `/images/create` and must use the typed pull route. Production deployment-worker raw image-build requests additionally require a validated `X-Upstand-Resource-ID`; Dockerfile, BuildKit, Nixpacks, Railpack, Buildpacks, static, and Compose subprocesses propagate that scope through Docker CLI custom headers, and Railpack now emits the exact ownership label required by the raw build policy. Local resource-only command requests now let the broker resolve a running container only from the exact system-owned `com.upstand.resource-id` label, avoiding a preliminary raw container-discovery call; Compose-generated services receive that label during configuration. The command, convergence, pull, service, push, build, network, volume, and rollback routes are available only to server, schedules, and deployment-worker identities and enforce bounded resource identities, image metadata, context size, build metadata, non-secret build-argument shape, registry-auth shape, response fields, ownership, and cleanup. These are typed broker contracts with strict operation-specific field validation and schema-validated response models; file operations additionally require a named-volume mount. The remaining raw broker exposure is concentrated in deployment-worker Compose/service orchestration, secret-bearing build paths, unsupported credential/fallback paths, and explicit remote paths.
- **Latest deletion/network hardening:** Local resource, database, replication, and deployment-revision service deletion now uses the typed resource-service removal operation when the broker is configured. Isolated per-resource overlay-network creation/lookup/removal now uses a typed resource-network operation; it derives the deterministic name, creates only an encrypted attachable overlay with an exact owner label, and rejects pre-existing name collisions before service deployment. Database-volume cleanup uses a typed resource-volume operation. The broker re-inspects each requested object and verifies deterministic resource naming, overlay/swarm properties, managed isolation labels, or the built-in local driver with empty options before deletion; mismatched ownership is rejected before Docker mutation and missing objects are idempotent. Production server and deployment-worker identities are denied raw service, network, and volume deletion. Focused broker runtime/policy tests plus infrastructure delegation, network-label, and volume-ownership tests pass.
- **Latest Caddy hardening:** Local Caddy initialization and configuration sync now use `/upstand/v1/web-server/caddy` and `/upstand/v1/web-server/caddy/configure`; the broker owns the fixed image, container command, four named volumes, encrypted managed overlay network, bounded environment, port-binding shape, bounded certificate archive, validation, reload, and rollback flow, and refuses an unowned existing Caddy container before any deletion. Focused TypeScript and Go tests cover capability delegation, archive permissions/traversal, transactional reload, and server/worker policy separation.
- **Latest build hardening:** Local Dockerfile builds now use `/upstand/v1/server/resource-build` for bounded, `.dockerignore`-filtered contexts with validated non-secret build arguments and build targets as well as ownership labels. The remaining raw Dockerfile/static build path now adds the exact resource ownership label and the broker rejects missing/mismatched ownership, remote contexts, output exporters, host/container network modes, weakened security options, traversal-enabled Dockerfile paths, malformed/unbounded arguments, and sensitive arguments; secret-bearing builds remain explicitly identified as raw-path work.
- **Latest raw-build boundary hardening:** Production deployment-worker raw `/build` requests now require a valid tagged image and exact `com.upstand.resource-id` ownership label in the query, reject remote contexts, output exporters, host/container network modes, weakened security options, Dockerfile traversal, null/malformed/unbounded arguments, and sensitive argument names, and have Go policy plus infrastructure subprocess regression coverage. Compose build arguments now require literal values and reject secret-like names in both mapping and list forms because Docker may persist their values in image history; environment interpolation and implicit environment lookup are rejected. The broker also bounds both declared and chunked legacy raw build contexts to the same 512 MiB streaming limit as typed builds. Raw Dockerfile and static-image subprocesses now add the ownership label; broader Compose orchestration and remote service mutation remain open transport slices.
- **Latest Dockerfile secret boundary hardening:** Application Dockerfile builds no longer copy resolved runtime/build environment values into `--build-arg`. Explicit `dockerBuildArgs` are bounded, validated POSIX names/values, and reject secret-like names; resolved environment and configured build-secret values are supplied only through BuildKit's `--secret id=...,env=...` channel, keeping them out of image history and command arguments. Build-variable overrides for `DOCKER_HOST`, Docker credentials, Compose control variables, and custom broker headers are filtered before child-process execution, while secret-free explicit arguments continue through the typed resource-build route. The credential-safe typed transport for secret-bearing builds remains open.
- **Latest Compose build-source hardening:** Compose services now reject network-style build contexts, including HTTP(S), Git, URI, and SSH-style sources, across the short syntax, mapping syntax, and `additional_contexts` forms. Build secrets, external cache import/export, host networking, and BuildKit entitlements are also rejected. This prevents the Docker daemon from fetching unreviewed build input, forwarding host credentials, reaching arbitrary external build endpoints, or exporting build data; bounded local contexts continue through the existing generated-workspace and `.dockerignore` controls. Focused Compose security regressions cover each accepted syntax family.
- **Latest Compose task-boundary hardening:** Compose validation also rejects deploy-level privileged/capability/device/security/sysctl controls, reserved host devices, custom runtimes, host GPUs, and `service:host` namespace references. This closes equivalent host-escape controls expressed through the Swarm/Compose deployment model, including mapping-shaped sysctl declarations; focused regressions cover list and mapping forms.
- **Latest worker-grant boundary hardening:** Deployment jobs now carry a short-lived HMAC grant signed by the control plane and bound to the exact resource, deployment, and target server. The deployment worker does not receive the signing secret; Dockerode, Docker CLI, and broker-stream transports propagate the grant from async-local job context; production broker requests reject missing, expired, tampered, or cross-resource grants. Go and TypeScript tests cover the verifier, transport propagation, and concurrent context isolation. The remaining raw Compose and secret-bearing build paths are still not fully typed.
- **Latest raw service-network hardening:** Production deployment-worker raw service create/update requests now daemon-inspect every explicit `TaskTemplate.Networks` and top-level `Networks` target before forwarding. Only encrypted, attachable Swarm overlay networks are accepted, and targets must be the configured shared network or a managed network labelled for the same resource; update requests revalidate both existing and requested attachments. Focused fake-daemon regressions cover owned, configured-shared, foreign, missing-target, and update cases. Raw Compose/service-create transport remains an open migration slice.
- **Latest raw file-backed-resource hardening:** Production deployment-worker raw and typed resource-service create/update flows now inspect every Swarm `SecretID`/`SecretName` and `ConfigID`/`ConfigName` reference through the daemon before service mutation. References must resolve to the requested resource's exact ownership label or resource-scoped Compose name; named service volumes must also use the exact deterministic database or resource-Compose ownership prefix, with case-insensitive Docker field parsing covered. Missing, mismatched, foreign, unbounded, and malformed references fail closed. Compose config/secret definitions now reject external resources and unsafe file/name paths, and owned definitions receive deterministic resource-scoped Docker names. Focused Go and use-case regressions cover raw create, raw update-time revalidation, typed upsert, typed cross-resource and mixed-case volume mounts, Compose scoping, and external/host-backed rejection. The broader raw Compose/service orchestration transport remains an open migration slice.
- **Latest raw service-volume hardening:** Production deployment-worker raw and typed resource-service create/update flows now re-inspect every named service volume through the Docker daemon immediately before mutation. The live volume must have the exact requested identity, the built-in local driver, no driver options, and either the exact legacy database-volume name or managed resource-isolation labels; prefix-only names, foreign labels, and host-backed options fail closed. Focused Go regressions cover raw service mounts, typed service mounts, foreign ownership, hostile options, and the legacy database-volume compatibility path. The broader raw Compose/service orchestration transport remains an open migration slice.
- **Latest worker-read hardening:** Production deployment-worker callers are denied global Docker metadata and inventory (`/info`, `/images/json`, `/nodes`, `/system/df`, and `/volumes`). Worker Swarm status now uses the bounded typed `swarm` info operation; resource-scoped service, task, network, volume, and container reads remain available only through exact filters or live ownership checks; typed inventory remains the preferred control-plane path.
- **Latest broker-policy parsing hardening:** Raw Docker JSON policy walkers now normalize field names case-insensitively before evaluating ownership, host escape, namespace-sharing, security-option, bind/mount, and volume-driver rules. This closes the Go JSON decoder’s case-insensitive field-matching gap for lower-case or mixed-case payload keys; regression coverage rejects lower-case resource-volume binds, Docker-socket binds, privileged mode, `container:` namespace sharing, and `no-new-privileges=false`. The broader raw Compose/service-create transport remains an open migration slice.
- **Latest raw Swarm task-policy hardening:** The broker’s case-insensitive Docker JSON host-escape walker now rejects Swarm `CapabilityAdd`/`capabilityadd`, non-empty `Sysctls` list or mapping forms, and `service:` namespace modes in addition to the existing container/host/device/security checks. This closes equivalent raw `/services/create` and `/services/{id}/update` task controls that are not represented by the REST container `HostConfig` field names; focused broker policy regressions cover mixed-case capability/sysctl payloads and `service:host`.
- **Latest worker container boundary hardening:** Production deployment-worker requests for container start/stop/restart/kill/wait/rename/update/resize/exec, archive writes, and container deletion now require a valid `X-Upstand-Resource-ID`; global `/build/prune` is denied to the worker alongside container/image pruning. Before raw forwarding, the broker re-inspects target containers and updated Swarm services and requires the exact system-owned resource label. Network connect/disconnect requests require bounded container identity, encrypted attachable overlay inspection, and either the configured shared network or a managed, resource-labelled isolated network. Focused broker policy and fake-daemon preflight tests cover owned, cross-resource, malformed, and unencrypted cases. The remaining raw Compose/build/service-create transport is still a migration gap.
- **Latest exec/read isolation hardening:** Production deployment-worker access to raw `/exec/{id}/json`, `/exec/{id}/start`, and `/exec/{id}/resize` now resolves the exec object to its container and requires the container’s live exact resource label before forwarding. Raw container inspection, logs, stats, changes, top, archive, and lifecycle paths now perform the same daemon-side ownership check, closing cross-resource read and exec-object confused-deputy paths. Focused fake-daemon tests cover owned and foreign exec/container cases.
- **Latest raw container-list boundary hardening:** Production deployment-worker `GET /containers/json` now fails closed unless it receives one bounded `filters` value containing the exact `com.upstand.resource-id=<resource>` label. Compose convergence, discovery, routing, stop, teardown polling, logs, controls, and resource command fallbacks now use the resource-scoped Docker client and include that ownership label. Go policy tests and a TypeScript scoped-client regression test cover missing, malformed, foreign, and correctly scoped filters.
- **Latest workload-boundary hardening:** Compose validation now rejects environment-interpolated and long-syntax bind sources, host-backed volume/network driver options, unsupported volume/network drivers, and unsafe built-in network names before any CLI deployment. The broker's raw JSON policy now rejects every non-telemetry absolute bind source, not only a sensitive-path denylist. Typed resource service mutation accepts only bounded named Docker volumes, so a non-denylisted host path cannot bypass the broker's host-escape policy.
- **Latest Compose resource hardening:** Compose validation rejects external resource references and unsafe resource keys; explicit network/volume names are project-scoped; network and volume ownership labels are system-controlled; and local Compose deployments pre-provision all user-defined networks and named volumes through owner-labelled typed broker operations before marking them external in the generated manifest. Production deployment workers cannot call raw network/volume creation and can only ensure the configured shared network through the typed Swarm route. The Compose CLI orchestration itself and service mutation remain constrained raw transport slices.
- **Latest runtime secret hardening:** The mandatory UpGal approval-signing secret is now generated and persisted by the installer, loaded by both runtime entrypoints, injected as a Docker secret into migration/server/schedules/deployment-worker services, and created by release acceptance before the production stack is deployed. Local Compose provides an explicit disposable development value. Contract tests cover installer, Compose, and release-workflow wiring.
- **Latest manifest-lifecycle hardening:** Generated Compose manifests are written with owner-only permissions on Unix deployment hosts, and the temporary resource workspace is removed when preparation, command execution, convergence, or manifest writing fails. The Compose CLI now runs with a minimal environment, filters resource variables that could redirect Docker or Compose, and rejects protected Docker transport interpolation after configuration injection. Infrastructure and use-case regression tests verify private mode, failure cleanup, child-process isolation, and post-configuration validation; Compose orchestration and secret-bearing build transport remain open typed-capability slices.
- **Latest CI assurance hardening:** The Linux CI gate now runs both ordinary and race-detector Go tests plus `go vet` for the monitoring service and Docker broker. A release-orchestration contract test asserts that the race and vet checks remain present. The Windows development host cannot execute the race detector locally because its Go toolchain has no C compiler; the hosted Ubuntu gate is the authoritative race verification environment.
- **Latest release-integrity hardening:** The stable-tag workflow now requires the repository's `master` ref for both push-triggered and manually dispatched executions, preventing an operator from accidentally creating a stable tag from `canary` or another arbitrary ref. The release-orchestration contract test covers this branch constraint; hosted actionlint and the complete PR validation matrix pass on the guarded workflow.
- **Latest teardown hardening:** Local Compose and Swarm-stack teardown now uses `/upstand/v1/server/resource-teardown`. The broker enumerates the project-scoped containers or stack services, re-inspects every object for the exact system-owned resource label before any delete, and removes only project-labelled networks plus local, empty-option, project-labelled volumes when requested. Compose configuration now applies the ownership label to every service, including services outside an optional service override. Cross-resource teardown, arbitrary fields, and unsupported object shapes are covered by broker runtime/policy tests.
- **Current hardening:** Production now separates schedules orchestration from deployment queue execution. The `deployment-worker` has its own caller token, mTLS certificate/key, `UPSTAND_SCHEDULES_ROLE`, replica setting, read-only/non-root runtime, and acceptance checks. Its DI graph resolves `DockerDeploymentToken` through `createDockerDeploymentPort`, which exposes only deployment/build/convergence operations and has a regression test excluding inventory, pruning, and daemon-wide image methods. Workload migration and autoscaling resolve separate method-bound ports, and API resource workflows resolve separate method-bound control, read, command, database, and runtime-stat capabilities; remote resolution filters returned services to the requested capability shape. Web-server maintenance and self-update now resolve typed broker clients: self-update accepts only validated release digests and allowlisted service names, maintenance covers bounded service, network, and cleanup operations, and Swarm management covers all eleven cluster operations with strict request schemas and validated response mapping rather than raw Dockerode transport. GPU inspection/setup remains a separate local host capability. The broker still remains a constrained Docker API for broader API-facing maintenance paths rather than a fully typed transport.
- **Evidence:** `docker-broker` is the only production service with `/var/run/docker.sock`; server/schedules/deployment-worker use `https://docker-broker:2375` over a distinct encrypted internal attachable network. The installer generates a private CA, a broker server certificate, and distinct `upstand-server`/`upstand-schedules`/`upstand-deployment-worker` client certificates, rotates the identity when it is missing or within 30 days of expiry, validates the CA chain, server/client EKU, exact certificate subjects/SAN, and certificate-key pairing before reuse, and retains the CA key only in the secured installer secret directory. The broker requires TLS 1.3, verifies client certificates, maps certificate subjects to callers, rejects certificate/token identity mismatches, and retains caller-specific tokens as defense in depth. It uses a deny-by-default allowlist for reviewed lifecycle, build, network, volume, service, task, exec, archive, and cleanup operations, permits only built-in `local`/`bridge`/`overlay` drivers, rejects plugins/auth/session/swarm/events/system administration, rejects JSON host-escape primitives (privileged mode, host modes, devices, unsafe binds, host-backed volume options, custom runtimes, weakened security profiles, and writable telemetry binds), emits normalized caller/operation/status/latency records, bounds concurrent requests with `UPSTAND_DOCKER_BROKER_MAX_INFLIGHT` (64 by default, 1–256), and enforces explicit HTTP timeouts and header limits. Server, schedules, and deployment-worker mount caller-specific broker identities under Docker CLI's standard `ca.pem`/`cert.pem`/`key.pem` names with TLS verification enabled. Production server caller policy additionally rejects raw `/build` and service create/update operations; production schedules and deployment-worker callers additionally reject raw `/images/create`; production deployment-worker raw image builds additionally require a validated `X-Upstand-Resource-ID`, propagated by Dockerfile, BuildKit, Nixpacks, Railpack, Buildpacks, static, and Compose subprocesses via Docker custom headers, and raw Swarm service create or update requests require the matching system-owned resource label. Typed resource inventory, file, command, convergence, pull, service, push, and bounded non-secret build routes independently validate operation fields and resource scope; pull accepts only bounded safe image references and forwards optional registry credentials ephemerally; command routes enforce bounded command, timeout, and output and service-scoped execution resolves a running task before checking the exact resource label; convergence verifies the service label and container ownership before returning bounded state; service mutation verifies the exact owner label before create/update, restricts network attachment to overlay networks, and forwards registry credentials only as a bounded, ephemeral `X-Registry-Auth` header for upsert; push verifies the exact image ownership label and forwards credentials only for the push request; build verifies image/Dockerfile metadata, rejects sensitive build arguments and all build secrets, filters the context using `.dockerignore`, and bounds context, build-argument, and response sizes; file routes also enforce named-volume and path/symlink boundaries. Typed-route authorization tests covering cleanup, digest-bound self-update, Swarm field/operation bounds, resource-file bounds, resource-command/convergence/service/push/build/pull bounds, registry-auth forwarding, runtime fake-Docker tests covering managed-service mutation, source rejection, Swarm inventory, resource-label ownership, fixed command wrappers, service-task resolution, bounded output, node/health state, local resource service mutation, bounded build forwarding, bounded pull/error handling, and sensitive-argument rejection, schema-validated TypeScript broker mapping, the infrastructure capability tests, the self-update use-case focused tests, Go tests, vulnerability scans, certificate generation/verification, and Compose/installer/acceptance contracts pass.
- **Impact:** A control-plane compromise can still request ordinary daemon operations, delete resources, or create workloads within the broker’s remaining API surface; worker raw build and resource-mutation requests are now resource-scoped but are not yet all typed. The boundary is materially smaller than a raw socket but is not a typed deployment authority.
- **Attack Scenario:** A server or scheduler RCE reaches the broker through the control network and abuses an unmodeled Docker API path or policy gap.
- **Reproduction:** `go test ./...` in `apps/docker-broker`, `docker build --file apps/docker-broker/Dockerfile ...`, and the Compose contract passed; no production mutation was attempted.
- **Recommended Fix:** Continue migrating the broker’s remaining raw transport for build, service mutation, and resource orchestration to typed resource-scoped capabilities, where practical replacing raw transport operations with typed DeployResource/RemovePreview operations. Keep local convergence and deployment hooks on their typed routes, and retain the mTLS identity, caller-bound credentials, reviewed allowlist, and explicit orchestrator/worker process boundary.

### F-002 — Electron packaging advisories (resolved)

- **File:** scripts/security-audit.sh:13-16
- **Function/Class:** bun audit release gate
- **Severity:** Major
- **Category:** Supply chain / CI integrity
- **Problem:** Electron Forge packaging previously pulled vulnerable `image-size` and `extract-zip` versions.
- **Evidence:** The DMG maker was removed, macOS release output remains ZIP-based, and the remaining Forge extractor is replaced through the checked-in `@electron-internal/extract-zip` compatibility shim. `bun audit --audit-level=high` now reports `No vulnerabilities found`; the security contract rejects all advisory suppressions. Desktop packaging, tests, and typechecking pass. Go 1.25.13 broker and monitoring builds pass `govulncheck` with no reachable vulnerabilities.
- **Impact:** The release dependency gate no longer promotes known high-severity JavaScript packaging advisories.
- **Attack Scenario:** A compromised or tampered packaging input reaches the Electron packaging job and exploits unsafe archive extraction on the runner.
- **Reproduction:** Run bun audit --audit-level=high and compare with bash scripts/security-audit.sh.
- **Recommended Fix:** Keep the zero-advisory gate and re-evaluate the extractor shim and macOS packaging path whenever upstream releases change.

### F-003 — Control-plane DR is implemented but not installation-proven

- **File:** docker-compose.prod.yml:23-24, 92-93, 592-596; scripts/backup-restore-rehearsal.sh:63-152
- **Function/Class:** Bundled PostgreSQL/Redis volumes and backup rehearsal
- **Severity:** Major
- **Category:** Disaster recovery / availability / durability
- **Problem:** The web-server backup workflow can dump the control-plane PostgreSQL database, archive Caddy state, upload to S3-compatible storage, and restore with verification, but production still does not prove a real-data restore. Bundled PostgreSQL and Redis still use local volumes; the installer’s recovery-plan attestation is not independent evidence.
- **Evidence:** `createWebServerBackup` emits `control-plane.dump`, Caddy volume archives, and a manifest; web-server verification validates the dump with `pg_restore -l` and streams every Caddy archive through a pinned Alpine tar listing with traversal checks before recording `restoreTestedAt`. Schedules require a successful backup, positive freshness threshold, and restore-tested latest success by default. S3-compatible destinations default to SSE-S3 (`AES256`) unless an explicit reviewed encryption mode is supplied. The installer now requires and persists off-site, key-escrow, immutable-retention, RPO/RTO, and evidence-reference fields, and production acceptance checks them when the installation gate is enabled. The signed installation evidence verifier now also requires bounded installation, backup-artifact, restore-target, release, and non-future recovery-point references. The operational rehearsal can require a restore verification newer than the latest successful backup and emits a non-secret JSON evidence record explicitly marked `synthetic-disposable`; the release full profile uploads that record alongside its log. The disposable MinIO/PostgreSQL rehearsal passed with 6.369 seconds total and 0.099 seconds restore timings; no installation-specific escrow test, measured production RPO/RTO, or real-data restore record is present.
- **Latest runtime evidence:** The PowerShell disposable MinIO/PostgreSQL rehearsal passed against the immutable local Upstand server image with 6.427 seconds total, 0.088 seconds restore, and a restored data-marker assertion. This strengthens runtime coverage but remains explicitly synthetic-disposable and does not satisfy the installation-specific off-site, escrow, RPO/RTO, or real-data evidence requirement. Production Compose now defaults `UPSTAND_DR_READINESS_GATE` to `true`, so the installation-specific gate is fail-closed outside explicitly marked disposable/release environments.
- **Impact:** Node/volume loss can lose organizations, sessions, API-key metadata, audit records, encrypted configuration, and control-plane recovery capability.
- **Attack Scenario:** Disk failure, accidental deletion, ransomware, or operator error destroys the node; workload backups may exist but actual control-plane reconstruction and key recovery are unproven.
- **Reproduction:** Inspect the production volumes and scripts; no production backup service, off-host retention, or real-data restore acceptance is wired into the stack.
- **Recommended Fix:** Replace the attestation-only portion with independently verifiable destination/object-lock and key-escrow checks, then make a scrubbed real-data restore rehearsal with measured RPO/RTO a release/operations gate.

### F-004 — Live resource E2E is intentionally opt-in

- **File:** apps/server/src/e2e/resource-lifecycle.e2e.test.ts:17-45
- **Function/Class:** Local E2E resource lifecycle tests
- **Severity:** Minor
- **Category:** QA / release engineering / reliability
- **Problem:** The default test process previously attempted live resource calls against localhost despite no configured server, creating false timeout failures.
- **Evidence:** The support context now enables resource lifecycle calls only when an explicitly available server/base URL is configured; the default suite skips those live checks and the full test suite is green.
- **Impact:** The normal gate is deterministic, but release validation must still run the opt-in live E2E suite against the intended topology.
- **Attack Scenario:** Not a direct exploit; an unknown deployment state can cause duplicate actions or hide failed deployment.
- **Reproduction:** Run bun run test.
- **Recommended Fix:** Keep the explicit opt-in contract and require live E2E evidence in the release acceptance workflow for deployments that claim resource lifecycle coverage.

### F-005 — Legacy instance ownership must fail closed

- **File:** packages/api/src/permissions.ts:194-220
- **Function/Class:** InstancePermissionService.isInstanceOwner
- **Severity:** Major
- **Category:** Authorization / privilege assignment
- **Problem:** Older or damaged installations may have no explicit owner identity.
- **Evidence:** New self-hosted initial-account creation persists `control_plane_identity.owner_user_id`; the current authorization path no longer selects the earliest-created user and returns false when the persisted/configured owner is absent. A configured legacy owner can repair the missing persisted identity through `/api/control-plane-transfer/owner/repair`, which requires an interactive step-up session, explicit confirmation, a compare-and-set on a null owner, and audit records. An existing owner can transfer ownership through `/api/control-plane-transfer/owner`, which requires an unbanned target, a compare-and-swap on the current owner, and control-plane audit records for success/failure.
- **Impact:** Legacy instances remain unavailable for instance-wide operations until an authorized operator explicitly repairs ownership, which is safer; the repair/transfer workflow still needs installation evidence and an operational runbook.
- **Attack Scenario:** A deployment is initialized without an explicit owner; the first account is later compromised or belongs to the wrong operator and can invoke instance-wide operations.
- **Reproduction:** Leave both owner variables unset, create users in a controlled order, and call an instance-authorized route as the first user.
- **Recommended Fix:** Exercise the repair and transfer paths on a legacy fixture, retain installation runbook evidence, and add live transfer/rollback acceptance evidence.

### F-006 — Direct-IP HTTP bootstrap can downgrade auth cookies

- **File:** packages/auth/src/index.ts:115-126, 186-216
- **Function/Class:** normalizeDirectIpAuthResponse
- **Severity:** Major
- **Category:** Session security / transport security
- **Problem:** Direct HTTP IP/loopback requests can have Secure and Domain cookie attributes removed so bootstrap works.
- **Evidence:** The behavior is explicitly documented and implemented. The installer requires HTTPS unless `UPSTAND_ALLOW_INSECURE_BOOTSTRAP=true`, runtime cookie normalization requires both explicit direct-origin mode and explicit insecure-bootstrap mode in production, production accepts plaintext bootstrap only for loopback/private/link-local direct addresses, and the server rejects every non-health direct-IP HTTP request after the first self-hosted account exists. Public direct addresses are rejected before cookie normalization or origin trust. The initial mode remains dangerous until TLS cutover.
- **Impact:** Session cookies can traverse plaintext HTTP and be stolen by a network observer or intermediary.
- **Attack Scenario:** An operator enables insecure bootstrap on a reachable host and logs in over an untrusted network; an attacker captures the session cookie.
- **Recommended Fix:** Keep the one-time account-state gate and record installation evidence that the flags are disabled after TLS cutover.

### F-007 — Direct-IP bootstrap origin trust is constrained but remains an explicit downgrade mode

- **File:** apps/server/src/http/middleware.ts:93-156; packages/auth/src/index.ts:277-291
- **Function/Class:** CORS/origin middleware and Better Auth trustedOrigins
- **Severity:** Major
- **Category:** CSRF / origin validation
- **Problem:** Explicit direct-origin bootstrap still permits a direct-IP origin, which is intentionally broader than configured DNS origins.
- **Evidence:** State-changing middleware and Better Auth now require a direct origin hostname to match the direct request hostname; mismatched direct-IP origins are rejected. Production direct-origin bootstrap additionally requires the host to be loopback/private/link-local, production still requires the explicit `UPSTAND_DIRECT_ORIGINS` mode, auth cookie downgrade additionally requires `UPSTAND_ALLOW_INSECURE_BOOTSTRAP`, and the server stops accepting direct-IP HTTP application traffic once the first self-hosted account exists.
- **Impact:** The CSRF boundary is materially narrower, but plaintext/direct-IP bootstrap remains unsafe on an untrusted network.
- **Attack Scenario:** An operator enables direct-origin bootstrap on a reachable host and signs in over an untrusted network; cookie downgrade and network interception remain possible.
- **Recommended Fix:** Keep the one-time account-state gate and record installation evidence that the flags are disabled after TLS cutover.

### F-008 — AI cost admission remains a conservative estimate without invoice reconciliation

- **File:** packages/api/src/routers/ai.router.ts:61-103; packages/api/src/ai-budget.ts:113-180; packages/api/src/ai/upgal.ts:2190-2238, 2291-2307
- **Function/Class:** /api/ai/chat, provider test/template calls, createUpGalResponse
- **Severity:** Major
- **Category:** AI abuse / cost control / data growth
- **Problem:** The daily organization cost budget remains an admission ceiling rather than provider invoice reconciliation. Public catalog pricing can also be absent or stale, so unknown usage must remain visible and cannot silently be treated as reconciled spend.
- **Evidence:** New conversation creation now occurs after Redis budget admission. Chat history is capped at 128 KiB, interactive output at 8,192 tokens, aggregate model usage at 32,768 tokens per run, provider tests at 256 tokens, and template generation at 4,096 tokens. Redis now atomically reserves each request’s run, worst-case token, and conservative integer-cent cost ceilings against `UPGAL_DAILY_RUN_LIMIT`, `UPGAL_DAILY_TOKEN_LIMIT`, and `UPGAL_DAILY_COST_LIMIT_USD`, per organization and UTC day. The configured `UPGAL_MAX_COST_PER_MILLION_TOKENS_USD` remains the minimum rate; known selected models use the greater of that operator floor and reviewed tokenlens pricing metadata, while unknown models retain the operator fallback. Both chat entry points and provider/template routes resolve model identity before admission, and rejected token/cost admission does not consume run quota. `ai_run` persists aggregate input, output, and total provider token counts after every model step. Runtime usage records aggregate estimated cents when both input/output rates are known and increments a separate unpriced-usage counter otherwise, without tenant/model labels. Tavily model-facing tools validate bounded URLs/depth/text and clip returned content; focused budget, catalog, and provider-identity tests pass.
- **Impact:** Input/tool amplification, unbounded per-run generation, and the configured worst-case daily admission exposure are bounded. Vendor spend still varies by model/provider price and the system does not reconcile actual usage to provider invoices.
- **Attack Scenario:** An authenticated member automates requests up to rate limits, submits over-budget runs, or repeatedly tests an expensive custom provider.
- **Recommended Fix:** Keep the checked-in pricing metadata reviewed and add provider billing/invoice reconciliation plus spend alerts. Keep the hard per-run ceilings, atomic token/cost reservations, durable token counters, aggregate priced/unpriced metrics, and operator model allowlist.

### F-009 — AI untrusted-data handling has a typed boundary but still needs adversarial evaluation

- **File:** packages/api/src/ai/upgal.ts:2291-2307 and adjacent UpGal tool construction
- **Function/Class:** ToolLoopAgent and createUpGalTools
- **Severity:** Major
- **Category:** Prompt injection / tool authorization / data exfiltration
- **Problem:** Logs, Compose, repository data, and external tool results enter model context. The typed boundary reduces accidental authority transfer, but model interpretation remains part of the enforcement story and requires adversarial evaluation.
- **Evidence:** Web, Tavily, and opt-in MCP results now cross a bounded, schema-declared `external-untrusted` envelope under `data`; the serializer caps total characters/nodes, rejects cycles, unsafe metadata, prototype-shaped keys, and non-finite numbers, and focused execution/schema tests pass. The agent still receives dynamic instructions, tools, and runtime context; approval is selected by canonical tool name, mutations are approval-gated, and the AI SDK HMAC-signs approval continuations with a dedicated server-only secret so the browser cannot change the approved tool name or arguments. Every first-party tool validates input and re-checks tenant/resource scope, while MCP tools remain approval-gated and network-restricted.
- **Impact:** External result strings are no longer indistinguishable from trusted tool-control metadata at the tool boundary, and provider amplification is bounded. A model can still misinterpret untrusted text or present a misleading explanation, so destructive-action adversarial evaluations remain required.
- **Attack Scenario:** A tenant-controlled build log tells the agent to ignore policy and call a deployment or secret-adjacent tool; the model follows it or presents a misleading approval description.
- **Recommended Fix:** Retain the typed provenance envelope, enforce scope in every tool, retain the signed approval binding and re-check authorization at execution, and run adversarial prompt-injection evaluations against every enabled provider/integration.

### F-010 — Preview limit has a check/create race

- **File:** apps/server/src/http/routes/webhooks.ts:253-302
- **Function/Class:** GitHub pull-request preview webhook handling
- **Severity:** Major
- **Category:** Concurrency / resource exhaustion
- **Problem:** This was a check/create race for different PRs; the current path now serializes quota decisions on the resource row.
- **Evidence:** Preview quota creation now lives in `CreatePreviewDeploymentUseCase`; the domain repository contract requires `resourceRepository.lockById`, and the count and insert run inside the unit-of-work transaction after that resource-row lock. The unique PR constraint remains the idempotency backstop. A concurrent different-PR regression test proves a limit of one produces exactly one preview and one limit rejection, while a missing lock fails closed.
- **Impact:** The affected resource’s preview quota is no longer exceeded by concurrent handlers using this path; live concurrent webhook evidence remains useful.
- **Attack Scenario:** A contributor opens/synchronizes many PRs concurrently or replays valid deliveries across different PR numbers.
- **Recommended Fix:** Keep the mandatory per-resource lock and run the concurrent webhook integration test against the release database profile and live delivery path.

### F-011 — Preview cleanup deletes DB state after Docker failure

- **File:** apps/server/src/http/routes/webhooks.ts:321-331
- **Function/Class:** Pull-request close cleanup
- **Severity:** Major
- **Category:** Resource lifecycle / cost leak / reconciliation
- **Problem:** This was a Docker cleanup failure followed by unconditional row deletion.
- **Evidence:** Failed removal now leaves the row with `cleanup_pending`; only confirmed removal deletes it, preserving a durable retry marker. A schedules-owned reconciliation loop now reads a bounded ordered batch after every process start and every minute, resolves the parent resource's local/remote Docker target, retries through the resource-scoped cleanup capability, deletes only after successful cleanup, and retains failed or orphaned records. Focused use-case coverage proves bounded batching, successful deletion, failure retention, and missing-parent retention.
- **Impact:** A transient Swarm outage no longer erases the record needed for retry or reconciliation.
- **Attack Scenario:** A transient Swarm outage occurs during PR close; the row disappears while the service remains.
- **Recommended Fix:** Completed in code with the scheduled retry worker and focused regression coverage; repeated close delivery and live remote-target evidence remain useful release evidence.

### F-012 — Backup relationships needed database-enforced same-organization invariants

- **File:** packages/db/src/schema/backup.ts:12-23, 61-75
- **Function/Class:** backupSchedule and backupRun
- **Severity:** Minor
- **Category:** Database integrity / tenant isolation
- **Problem:** Backup schedules and runs carried organization, schedule, and destination IDs independently, so same-organization relationships were application-enforced only.
- **Evidence:** Generated migrations `0091` and `0092` now add source-backed composite uniqueness before the same-organization foreign keys for schedule/destination references; the fresh-schema portable PGlite transfer test now exercises the complete catalog successfully. Existing organization foreign keys remain present. Resource ownership remains inherited through the non-null `resource → environment → project → organization` chain and is explicitly not represented as a denormalized resource organization column. A full-schema PGlite repository test now proves organization-scoped resource discovery follows that chain after a valid environment move and rejects orphan resource inserts at the resource/environment foreign key.
- **Evidence add:** `scripts/external-services-smoke.ps1` passed against immutable `upstand-server@sha256:6a4e44a2374fcaffc92d5ccdccee2adc7f52f3d3396a9087cbeaa72007753139`, applying migrations to disposable external PostgreSQL and then rerunning them against the upgraded database before the live health check.
- **Impact:** Direct database writes can no longer attach a backup schedule/run to another organization’s destination or schedule; resource-level ownership still depends on the normalized relationship.
- **Attack Scenario:** A flawed update changes one ID without the others; an organization-scoped query then acts on the wrong destination.
- **Recommended Fix:** Add database-level resource ownership constraints only if the schema deliberately denormalizes organization ownership; otherwise retain the normalized path and add direct database integration tests for it.

### F-013 — API-key creation precedes device approval claim (resolved)

- **File:** apps/server/src/http/routes/cli-device-auth.ts:138-173
- **Function/Class:** /api/cli/device/approve
- **Severity:** Minor
- **Category:** Authentication workflow / state consistency
- **Problem:** The route previously created an API key and only afterward claimed the pending device authorization. Expired/raced approvals could leave unused keys.
- **Evidence:** The route now atomically claims the pending code before key creation, completes approval only from the claiming state, deletes the key and releases the claim on failure, and has focused race/cleanup coverage.
- **Impact:** A raced or failed approval no longer creates an unowned API key.
- **Recommended Fix:** Retain the claim lease and add a durable reconciliation metric if operational evidence shows abandoned claims.

### F-014 — Typed deployment authority remains partial after image separation

- **File:** packages/infrastructure/src/docker/docker-deployment.adapter.ts; packages/usecases/src/ports/docker.ts; apps/schedules/src/workers.ts
- **Function/Class:** Runtime image build stages
- **Severity:** Major
- **Category:** Container attack surface / least privilege / supply chain
- **Problem:** The deployment worker now receives a typed capability object, but API-facing maintenance paths and the broker transport still expose broader daemon operations.
- **Latest iteration:** Local API inventory, container/resource control, pruning, container file operations, resource-container commands, deployment-worker pre/post hooks, local convergence, resource image pulls, registry-authenticated local image service create/update/network attachment, ownership-checked local image pushes, secret-free local Dockerfile builds, and deterministic resource database-volume cleanup now use typed broker routes with bounded operation fields, resource-label checks, named-volume checks where applicable, context filtering, ephemeral credential forwarding, and validated models; remaining production deployment-worker raw Swarm service create-update requests now require the exact system-owned resource label in addition to the scoped caller header, raw service/container mutations reject non-owned named volumes and all bind mounts, and raw build query options enforce the same ownership plus bounded image/Dockerfile/argument and network/security constraints. The rollback-marker helper now propagates the resource label to its temporary container, while application/database image pulls fail closed instead of deploying a stale local cache after a registry failure. Production server identities cannot use raw image-build or arbitrary service create/update/delete operations, and production schedules/deployment-worker identities cannot use raw image pulls, while deployment-worker orchestration/build, Compose, and secret-bearing build paths remain the next migration slice.
- **Latest teardown slice:** Local Compose and Swarm-stack removal now resolves through a typed resource-teardown capability that validates project identity, re-inspects all matching containers/services, requires the exact resource label before mutation, and limits network/volume cleanup to project-labelled objects and built-in local volumes. The raw `docker compose down`/`docker stack rm` teardown path is retained only for remote or legacy clients without the typed local broker.
- **Latest control slice:** Local Swarm-stack stop now uses the same ownership-checked typed teardown capability as resource deletion, so the direct `docker stack rm` fallback is retained only for remote or legacy clients without the typed local broker; standalone Compose stop preserves its existing container-only behavior. Focused infrastructure regression coverage proves the local Stack stop path sends the exact resource, project, stack-mode, and no-volume-delete scope to the broker.
- **Latest network slice:** Isolated resource network creation and lookup now resolve through a typed owner-labelled broker operation. It derives the deterministic network name, creates only an encrypted attachable overlay, and rejects pre-existing name collisions whose ownership label does not match the requested resource.
- **Latest raw service-network slice:** Raw deployment-worker service create/update requests now inspect explicit network targets through the daemon before mutation, require encrypted attachable Swarm overlays, and restrict attachments to the configured shared network or the requesting resource's managed network. Existing and requested update attachments are both revalidated; focused Go fake-daemon tests cover ownership, encryption, malformed targets, and update-time foreign-network rejection. Raw Compose/service-create transport remains open.
- **Latest raw container-network slice:** Raw deployment-worker container creation now requires explicit managed encrypted attachable network endpoints, rejects implicit daemon-default bridge placement and foreign network ownership, and permits only explicit networkless modes. Contradictory network-disabled/`none` requests with endpoints are rejected; focused Go fake-daemon tests cover owned, foreign, implicit-default, and networkless cases. Raw Compose/service-create transport remains open.
- **Latest raw file-backed-resource slice:** Raw and typed resource-service mutations now daemon-inspect Swarm secret/config references, require exact resource ownership labels or deterministic resource-scoped names, and revalidate existing service state as well as requested updates. Compose preprocessing scopes owned file-backed definitions and rejects external or unsafe host-backed paths; focused tests cover raw and typed routes plus malformed and foreign references. Raw Compose/service-create transport remains open.
- **Evidence:** `apps/schedules/Dockerfile` is a lean orchestrator image with Docker CLI and backup rclone only. `apps/schedules/Dockerfile.worker` is the separately built, pinned build-capable image with Pack, Buildx, Nixpacks, Compose, Git/SSH, and compiler tools. Compose, installer source builds, release publication, immutable manifest resolution, CI, and production acceptance require distinct immutable references and the deployment-worker identity has its own mTLS/token policy. `createDockerDeploymentPort` exposes only the deployment/build/convergence methods needed by the worker, and its test proves inventory, prune, swarm, and image-list methods are absent. The typed resource-pull route accepts bounded image references and optional bounded registry auth, while the typed resource-service route forwards only bounded, ephemeral registry auth for local Swarm service upsert, the typed resource-push route verifies the exact image ownership label before forwarding registry auth to Docker, and the typed resource-build route is covered for bounded Dockerfile metadata and context forwarding; secret-bearing build toolchains remain on the existing constrained transport pending a credential-safe streaming contract.
- **Latest policy-parsing hardening:** Raw broker policy evaluation normalizes Docker JSON keys case-insensitively, including nested labels/mounts/binds and host-escape controls, so lower-case or mixed-case payload keys cannot bypass resource ownership, host-path, namespace-sharing, or security-option checks. Focused Go regressions cover lower-case resource-volume, Docker-socket bind, privilege, `container:` namespace, and `no-new-privileges=false` escapes; broker transport breadth remains open for Compose and service creation.
- **Impact:** A compromise of the worker is constrained by the typed DI surface and caller-specific broker policy, but a compromise of API-facing maintenance paths can still request ordinary daemon operations within the broker’s remaining allowlist.
- **Attack Scenario:** Server code execution uses installed tools plus broker access/secrets to inspect or alter host and remote deployment state.
- **Recommended Fix:** Migrate the remaining deployment orchestration/build, Compose, and secret-bearing service-mutation paths to resource-scoped typed capabilities and bind each deployment job to an auditable resource/payload scope at the broker boundary.

### F-015 — Prometheus coverage is incomplete beyond core API RED metrics

- **File:** ops/observability/prometheus.yml:1-12; ops/observability/upstand-alerts.yml:1-122
- **Function/Class:** Prometheus scrape and alert configuration
- **Severity:** Major
- **Category:** Observability / incident response
- **Problem:** The configuration now scrapes schedules and the API, but deeper broker, web, and full request-cost SLOs are still absent.
- **Evidence:** `/_internal/metrics` is token-protected, exposes low-cardinality API request status, bounded route-family request status and latency histograms, uptime, resident-memory, authentication-outcome, webhook provider/status/latency, aggregate PostgreSQL pool gauges, AI budget admission, and model-priced/unpriced aggregate usage-cost metrics. Prometheus has an authenticated `upstand-server` job with 5xx/memory/authentication-rejection/database-pool/route-latency/deployment-latency/webhook-error/webhook-authentication-rejection alerts. The shared redacted job-telemetry boundary now exposes bounded operation/outcome execution counters and duration totals through the schedules scrape, with a continuous background-job failure alert covering deployment, backup, notification, migration, and outbox operations. Broker health, web availability, and provider invoice reconciliation still lack dedicated metrics.
- **Impact:** Operators can detect API unavailability and elevated 5xx responses, but cannot yet localize several important production failure modes.
- **Recommended Fix:** Keep the bounded route-family and webhook RED metrics and alerts, then add deployment lifecycle, Redis pool, broker health, web availability, provider billing reconciliation, SLO runbooks, and a synthetic journey.

### F-016 — Go monitoring was outside CodeQL (resolved)

- **File:** .github/workflows/codeql.yml:25-33
- **Function/Class:** CodeQL workflow
- **Severity:** Minor
- **Category:** Static analysis / security assurance
- **Problem:** CodeQL was configured only for javascript-typescript; apps/monitoring is Go.
- **Evidence:** The workflow now declares javascript-typescript and go.
- **Impact:** Go-specific findings are now included in the primary CodeQL analysis; a separate govulncheck/staticcheck gate remains optional follow-up.
- **Recommended Fix:** Keep the Go CodeQL target healthy and add a dependency-vulnerability gate for the Go module.

### F-017 — Public docs chat validation was too broad (resolved)

- **File:** apps/fumadocs/src/app/api/chat/request.ts:5-8; apps/fumadocs/src/app/api/chat/route.ts:135-173
- **Function/Class:** Public /api/chat and searchTool
- **Severity:** Minor
- **Category:** Public AI abuse / validation / cost control
- **Problem:** messages was z.array(z.unknown()), while search query was z.string() without a maximum length.
- **Evidence:** Messages now require bounded roles/parts/text and the search query has a 2,000-character cap; output is capped at 1,024 tokens.
- **Impact:** Malformed and oversized public chat input is rejected before model conversion; provider token metering remains a broader AI follow-up.
- **Recommended Fix:** Continue expanding adversarial message-part tests and add provider token/cost accounting.

### F-018 — Better Auth edge protection was implicit (resolved)

- **File:** apps/server/src/http/routes/auth.ts
- **Function/Class:** Better Auth protocol handler
- **Severity:** Major
- **Category:** API security / abuse resistance
- **Problem:** Better Auth’s application protocol surface did not have an explicit Upstand distributed edge limiter or a route-specific request-body cap, leaving protection dependent on framework/provider defaults.
- **Evidence:** Every `/api/auth/*` request now passes through the shared Redis-backed request limiter and a 256 KiB body limit before the protocol handler; focused HTTP middleware, type, lint, and server checks pass.
- **Impact:** Credential, session, and verification endpoints have a bounded request cost and fail through the same limiter availability policy as other sensitive traffic.
- **Recommended Fix:** Retain the layered limiter and exercise the new production auth-failure/lockout telemetry through a paging runbook.

### F-019 — Server-rendered API origin trusted forwarded request headers (resolved)

- **File:** apps/web/src/lib/server-url.ts:42-61, 184-211
- **Function/Class:** `getServerUrlFromHeaders`
- **Severity:** Major
- **Category:** SSRF / proxy-header trust / authentication session routing
- **Problem:** Server-rendered dashboard session requests previously preferred `X-Forwarded-Host` and `X-Forwarded-Proto`, then inferred a sibling API origin from the resulting value. Without an application-visible trusted-proxy boundary, an attacker-controlled header or Host could redirect the server-side session fetch.
- **Evidence:** Host parsing now rejects malformed authority values; normal SSR uses `UPSTAND_SERVER_INTERNAL_URL` or the configured public API origin, and only a validated direct-IP `Host` is used for the explicit direct bootstrap path. `apps/web/src/lib/server-url.test.ts` covers spoofed forwarded host/protocol headers, arbitrary public Host fallback, and direct-IP forwarding-header spoofing.
- **Impact:** The web server no longer makes server-rendered session requests to an attacker-selected sibling domain through forwarded-header inference.
- **Recommended Fix:** Retain the configured-origin requirement and verify the production proxy preserves the canonical `Host` header; do not reintroduce forwarded-header inference without an explicit trusted-proxy contract.

## Iteration Status (2026-08-27)

| Finding | Current status |
|---|---|
| F-001 | Partial/remediated at the direct-socket, caller-identity, deployment-worker, migration, autoscaling, API resource, typed self-update, preview-cleanup, typed web-server-maintenance, typed cleanup, host-maintenance, typed Swarm, resource-command, resource-convergence, resource-pull, resource-service, resource-network, resource-volume, deployment-hook, scoped raw-container/read/exec/list/network/service-update/metadata and resource-fallback layers — only the dedicated broker receives the host socket, server/schedules/worker use distinct installer-generated identities, capability workflows resolve method-bound ports including on remote targets, deployment-worker grants are verified against resource, deployment, and server headers, raw image pulls and worker-global build-cache pruning are denied to schedules/deployment-worker callers, global worker image/node/disk inventory is denied, worker container/service listings require exact resource filters, worker task listings and service inspections require daemon-side owner verification, worker lifecycle/exec/network/service-update and service-volume operations and resource-specific cleanup fallbacks require a resource scope plus live daemon ownership/security preflight, and policy/scan/preflight tests pass; typed service mounts now require deterministic resource-owned volume names, raw service mounts now also require live volume ownership/driver/options verification, the raw broker policy rejects mixed-case Swarm capability/sysctl/namespace host-escape forms, and Compose network/Git/URI/SSH build fetches, build secrets, external caches, host networking, and BuildKit entitlements are rejected; broader build, Compose orchestration, and service-create transport review remains open. |
| F-002 | Remediated — the vulnerable DMG maker was removed, Forge extraction uses the checked-in Electron extractor compatibility shim, and the raw high-severity audit is clean with no suppressions. |
| F-003 | Partial — control-plane backup/restore mechanics and mandatory freshness plus restore-verification policy are present; the installer now enforces a persisted recovery-plan attestation, production acceptance requires fresh installation-specific signed evidence bound to the configured objectives/reference, the synthetic rehearsal emits explicitly scoped machine-readable evidence, and the full release profile probes authenticated encryption-key recovery without exposing the key. Installation-specific off-host destination, escrow access, and real-data restore evidence remain open. |
| F-004 | Remediated for the default test gate — resource lifecycle E2E now runs only when an explicitly available local server is configured; the opt-in live suite remains required for release evidence. |
| F-005 | Partial/remediated for ownership safety — new self-hosted bootstrap persists the owner, missing legacy ownership fails closed, and configured legacy owners now have a one-time, explicit-confirmation, step-up-protected repair path; existing owners have an audited transfer path and live evidence remains. |
| F-006/F-007 | Mostly remediated in runtime — direct-origin trust and cookie normalization are disabled in production unless both explicit bootstrap flags are enabled, production plaintext bootstrap accepts only loopback/private/link-local direct addresses, and non-health direct-IP HTTP is rejected after first account creation; installation cutover evidence remains. |
| F-008 | Partial/remediated for token/cost admission — quota admission, bounded history, per-step aggregate token ceilings, standalone output caps, atomic per-organization run plus worst-case token plus model-aware conservative cents reservations, durable failed-run finalization, and an exact operator model allowlist exist; provider invoice reconciliation remains. |
| F-009 | Partial/remediated in code — first-party scope checks, HMAC-bound approval gates, MCP restrictions with per-request endpoint/DNS revalidation, bounded provider output, and schema-declared model-facing provenance envelopes exist; adversarial evaluation remains. |
| F-010/F-011 | Remediated in code — preview quota uses a mandatory resource-row transaction lock and a tested quota use case; failed cleanup remains `cleanup_pending`; preview cleanup now carries the owning resource ID, requires an exact service ownership label before deletion, and has a bounded restart-safe scheduler retry path; focused use-case coverage passes, while repeated-close and live remote-target evidence remain. |
| F-012 | Remediated in source and migrations — generated migrations `0091` and `0092` add composite uniqueness first and same-organization foreign keys second for backup, AI, notification, server/SSH-key, registry/server, and S3/certificate relationships; fresh-schema portable transfer coverage and fresh-plus-upgraded external PostgreSQL migration smoke pass; and full-schema PGlite coverage proves normalized resource ownership follows the non-null resource/environment/project chain. |
| F-013 | Remediated — device approval claims before API-key creation, completes only from the claim, and cleans up both key and claim on failure; focused tests pass. |
| F-014 | Partial/remediated for image isolation, worker DI, migration, autoscaling, API resource workflows, typed self-update, preview cleanup, revision promotion, bounded local scaling, typed web-server maintenance, typed cleanup, host maintenance, typed Swarm control, resource-container commands, resource convergence, resource-pull, resource-scoped service, network, and volume cleanup, deployment hooks, resource-scoped worker builds, daemon-verified raw worker container/read/exec/list/network/service-update/metadata and service-volume mutations, resource-scoped service/volume/network fallbacks, and use-case SDK isolation — the orchestrator is lean, the worker is separately published with its own identity and acceptance checks, signed deployment grants are verified against the exact resource, deployment, and server target across Dockerode, Docker CLI, and broker-stream transports, raw worker image builds and container/service listing/reads/lifecycle/exec/network/service-update operations require a validated resource scope plus exact filtering or live ownership/security inspection, global worker image/node/disk inventory is denied, raw service mounts additionally require live volume ownership/driver/options verification, raw schedules/worker image pulls and worker-global build-cache pruning are denied, capability workflows receive method-bound ports with remote shape preservation, the use-case layer no longer imports the Docker SDK, and regression tests prove the narrowed surfaces; raw broker Swarm capability/sysctl/namespace escapes and Compose network/Git/URI/SSH build fetches, build secrets, external caches, host networking, BuildKit entitlements, deploy-level privilege/capability/device/security/sysctl controls, custom runtimes, and host GPUs are rejected, while broker transport breadth remains open for Compose orchestration and service creation.
| F-015 | Partial — Prometheus now scrapes token-protected API RED/process metrics, bounded route-family request/latency metrics, low-cardinality authentication outcomes, webhook provider/status/latency counters, aggregate PostgreSQL pool saturation, bounded background-job operation/outcome execution and duration metrics with failure alerting, and aggregate AI budget admission/request-cost counters with alerts; broker, web, and full provider invoice/request-cost reconciliation remain. |
| F-016 | Remediated — CodeQL now analyzes JavaScript/TypeScript and Go, and CI runs `govulncheck` for both Go production services. |
| F-017 | Remediated in code — docs-chat messages, parts, text, search query, and output are bounded. |
| F-018 | Remediated in code — Better Auth routes now have shared distributed request limiting and a 256 KiB body cap; protected HTTP middleware records low-cardinality authentication outcomes and Prometheus alerts on sustained rejection rates; live auth-failure paging evidence remains. |
| F-019 | Remediated in code — server-rendered session routing validates the Host authority, ignores forwarded host/protocol headers, uses configured/internal origins for normal domains, and preserves only the explicit validated direct-IP bootstrap path; focused URL-resolution tests pass. |

## Security Risk Matrix

| Risk | Likelihood | Impact | Rating |
|---|---|---|---|
| Broker policy bypass/control-plane Docker authority | Medium | Host/control-plane takeover if an unmodeled escape survives | Major |
| Control-plane node/volume loss | Medium | Organization/control-plane data loss | Major |
| Direct-IP HTTP session theft | Low–Medium | Account takeover | Major |
| Broad direct-IP origin trust | Medium | CSRF boundary weakening | Major |
| AI cost/prompt-injection abuse | Medium | Cost, destructive actions, data disclosure | Major |
| Preview cleanup/reconciliation gap | Medium | Resource exhaustion | Major |
| Unverified control-plane restore/key recovery | Medium | Organization/control-plane data loss | Major |
| Missing API/control-plane telemetry | High | Slow detection/incident response | Major |
| Server-rendered Host-header API origin spoofing | Low | SSR session fetch redirection | Minor residual |

## Technical Debt Matrix

| Debt | Cost of deferral | Priority |
|---|---|---|
| Privileged runtime images | Larger blast radius for every app bug | P0 |
| Unverified control-plane recovery and key escrow | Irrecoverable outage | P0 |
| Live production E2E evidence | Release confidence gap | P0 |
| Non-durable webhook reconciliation | Orphaned compute/cost leaks | P1 |
| Incomplete API/auth/deployment metrics | Late incident localization | P1 |
| Run-count-only AI budget | Vendor bill/noisy-neighbor risk | P1 |

## Scalability Assessment

| Scale | Assessment | Required work |
|---:|---|---|
| 100 users | Likely workable with one node, but release blockers remain | Resolve P0 blockers and establish restore evidence |
| 1,000 users | Plausible for moderate workload | API metrics, load tests, token budgets, transactional preview quota |
| 10,000 users | Not proven; local data services and webhook/AI fan-out constrain it | External HA data services, queue/DB load tests, retention policies |
| 100,000 users | Requires segmentation/redesign | Dedicated worker plane, partitioned data, per-tenant quotas, fault domains |
| 1,000,000 users | No credible evidence | New distributed architecture and capacity model |

Additional observations: AI history is bounded but retention limits are needed; instance-wide transfer audit is O(number of organizations); current Prometheus can establish basic API availability/error pressure but not deployment/auth/database saturation; live resource lifecycle E2E remains an explicit release-profile prerequisite rather than a default local-test dependency.

## Missing Systems Report

1. Typed operations for the remaining broker-backed maintenance paths, with independent capability audit; build and service mutation remain open, while deployment hooks, local convergence, self-update, web-server maintenance, cleanup, local inventory/control/prune, container file management, and Swarm management are already narrowed.
2. Independently verifiable off-host encrypted control-plane backup/WAL retention with separate key recovery.
3. Scheduled restore drills using real scrubbed control-plane data with measured RPO/RTO evidence.
4. API/auth/deployment/webhook/broker/request-cost RED metrics and paging runbooks; PostgreSQL pool saturation is now covered.
5. Synthetic login-to-deploy-to-rollback journey.
6. Installation-specific evidence for the persisted instance-owner lifecycle and independently authenticated legacy-owner repair.
7. Provider invoice reconciliation, conservative AI token/cost budgets, and spend alerts.
8. Durable orphan-resource reconciliation.
9. Coverage or changed-code coverage gates.
10. Installation-specific owner repair/transfer and recovery runbooks.
11. Incident runbooks for worker compromise, leaked sessions, provider compromise, poisoned AI/MCP results, rollback, restore, and key rotation.

## Top 20 Fixes by ROI

1. Migrate the remaining API-facing Docker maintenance paths to resource-scoped typed operations behind the existing capability-scoped identities.
2. Independently verify off-host encrypted control-plane backup, key escrow access, and a real-data restore drill.
3. Make live production E2E and restore evidence mandatory for release profiles.
4. Exercise the explicit, audited owner repair/transfer workflow on legacy installations and retain the evidence.
5. Enforce direct-IP bootstrap on private interfaces and record TLS-cutover evidence.
6. Split privileged tooling into short-lived worker images.
7. Add provider invoice reconciliation and spend alerts; retain the new conservative token/cost admission controls and model allowlist.
8. Enforce AI tool/data scope outside model instructions and add adversarial evaluations.
9. Add durable broker and preview reconciliation/observability.
10. Add API/auth/deployment/broker/web/request-cost SLO metrics and paging runbooks; retain the PostgreSQL pool saturation alert.
11. Add coverage, concurrency, and load gates.
12. Publish compromise/rollback/restore/key-rotation/owner-transfer runbooks.

## Top 10 Production Blockers

1. **Major:** The broker’s remaining raw transport still exposes reviewed daemon operations rather than fully typed resource-scoped capabilities; self-update, Swarm, resource-container commands, deployment hooks, local convergence, migration, autoscaling, API resource workflows, typed web-server maintenance, typed cleanup, and resource-scoped container file management now resolve narrowed authority and retain the mTLS workload identity boundary, while broader build and service-mutation operations remain open.
2. **Major:** No demonstrated installation-specific control-plane backup/restore with key recovery and measured RPO/RTO; production acceptance now verifies signed evidence, but the repository cannot supply the target installation’s real rehearsal record.
3. **Major:** The separate worker still carries a broad build toolchain and the broker transport remains broader than typed resource-scoped operations for maintenance paths, so worker/control-plane compromise impact is reduced but not eliminated.
4. **Major:** API/auth/deployment/broker/web/request-cost observability and paging coverage is incomplete.
5. **Major:** Legacy owner repair and transfer now have audited, step-up-protected workflows, but live recovery evidence and removal of environment overrides remain operational requirements.
6. **Major:** Explicit direct-IP/plaintext bootstrap remains a deliberate initial downgrade mode; runtime now closes it after first account creation, but private-interface and TLS-cutover evidence are still operational requirements.
7. **Major:** AI cost admission now uses a conservative operator-configured ceiling and optional exact model allowlists, but provider invoice reconciliation and adversarial evaluation of model-facing external-data handling remain.
8. **Major:** Installation-specific production E2E, off-host restore, and key-escrow evidence remain outside the hosted disposable release rehearsal; the stable tag workflow now requires its full synthetic/failure-injection/load/soak profile.
9. **Major:** Privileged worker separation and durable orphan reconciliation remain incomplete.

## Verification Performed

Passed:

- bun run check-types
- bun run lint
- bun run db:check
- full server, schedules, Fumadocs, and web production build completed during `bun run build`; the earlier local Windows process-memory failure was cleared by the successful retry
- bun run test (17 workspace tasks successful; live resource lifecycle checks are explicitly skipped unless a configured live server is available)
- bun test packages/api/src/ai-budget.test.ts packages/api/src/ai/upgal.persistence.test.ts (8 focused budget/persistence tests passed)
- git diff --check
- bash scripts/installer-contract.test.sh
- bash scripts/release-acceptance-contract.test.sh
- bash scripts/production-acceptance-contract.test.sh
- bun audit --audit-level=high (no vulnerabilities found)
- Go test/vet portion of CI-equivalent checks
- deployment-worker raw service-list, task-list, service-inspection, network-list, and network-inspection ownership policy tests, plus resource-scoped Swarm service-control regression coverage
- deployment-worker raw service-network preflight tests covering owned/shared encrypted overlays, foreign and malformed targets, and update-time revalidation
- deployment-worker signed-scope tests covering missing/expired/tampered, cross-resource, and cross-deployment/server replay rejection plus Docker transport header propagation
- deployment-worker raw and typed service file-backed-resource preflight tests covering owned, foreign, malformed, and update-time secret/config references
- MCP transport tests covering per-request DNS revalidation, blocked-address rejection before forwarding, request deadlines, endpoint safety, and untrusted-output provenance
- AI provider endpoint tests covering per-request DNS revalidation, loopback rebinding rejection, configured-origin enforcement, and redirect blocking
- `go test ./...` in `apps/docker-broker` and typed-route authorization tests
- Docker-broker case-insensitive raw-policy regression tests covering lower-case/mixed-case labels, mounts, binds, privilege, namespace-sharing, and security-option escapes
- typed self-update runtime tests with a fake Docker transport (managed services only, immutable digest mutation, source-install rejection)
- typed Swarm runtime tests with a fake Docker transport (inventory mapping and bounded node update)
- typed inventory/control/prune broker runtime tests with a fake Docker transport (schema-bounded inventory mapping and container control)
- typed resource-file broker policy/runtime tests with a fake Docker transport (path bounds, resource-label ownership, named-volume enforcement, fixed command wrapper, and binary-safe reads)
- typed resource-command and resource-convergence broker policy/runtime tests with a fake Docker transport (bounded command input, exact resource/service-label ownership, broker-side label resolution, and bounded health state)
- full-schema PGlite resource ownership coverage (organization-scoped discovery, valid environment moves, and orphan-FK rejection)
- local database/scheduled resource-command delegation tests (typed broker use, caller boundary, timeout/output bounds, and raw-exec avoidance)
- AI SDK approval continuation configuration with a dedicated server-only HMAC secret and AI policy regression tests
- atomic AI run/token/cost admission tests covering both API and legacy HTTP budget surfaces
- deployment adapter and worker hook regression tests proving local hooks require a resource ID and use the typed service-scoped command route
- typed web-server broker client and deployment-adapter focused tests
- typed cleanup/self-update authorization and server-maintenance adapter checks
- typed self-update use-case focused tests and server production build
- production broker policy test proving raw API-server service deletion is denied
- preview cleanup ownership propagation, typed broker delegation, and unowned-service fallback rejection tests
- bounded restart-safe preview cleanup reconciliation tests covering success, failure retention, and missing-parent retention
- production, installer, observability, release, and release-orchestration contract scripts
- server/scheduler builder-toolchain separation contract
- backup-restore rehearsal contract, synthetic evidence-scope contract, and synthetic secret-key recovery contract
- recovery-evidence verifier contract; release acceptance invokes schema, scope, assertion, fingerprint, and budget validation
- installation recovery evidence contract; Ed25519 signature, freshness, objective, reference-binding, and release-artifact hash checks
- deployment capability adapter regression tests (worker, migration, and autoscaling surfaces exclude unrelated Docker methods)
- Swarm/network capability regression tests and use-case SDK-boundary scan (no Docker SDK import remains in `packages/usecases/src`)
- Better Auth route edge limiter/body-cap checks plus server type/lint verification
- protected authentication outcome metrics, alert, focused middleware/metrics tests, and observability contract
- bounded route-family request/latency metrics, deployment p95 alert, focused rendering/normalization tests, and observability contract
- production direct-IP bootstrap private-address enforcement and public-address rejection tests
- aggregate PostgreSQL pool metrics, saturation alert, focused invalid-value coverage, and observability contract
- aggregate AI budget admission/request-cost metrics, sustained-rejection alert, and low-cardinality contract coverage
- shared background-job lifecycle metrics for deployment/backup/notification/migration/outbox operations, continuous-failure alert, and identifier-exclusion tests
- preview cleanup resource-ID propagation, typed ownership delegation, and unowned-service rejection tests
- typed revision-promotion ownership validation and local deployment delegation tests
- typed resource-service scaling validation and local autoscaling delegation tests
- Compose security regression tests covering interpolated/long-syntax binds, host-backed volume/network driver options, unsupported drivers, typed resource-service named-volume enforcement, host-gateway `extra_hosts`, service resource controls, and weakened security options
- Docker-broker regression coverage proving non-telemetry absolute binds are rejected while read-only telemetry binds remain supported
- production Compose contract coverage for the fail-closed installation DR readiness default
- full repository `bun run test`, `bun run check-types`, `bun run lint`, and `bun run build` after workload-boundary hardening
- generated same-organization database constraints for AI, notification, server/SSH-key, registry/server, and S3/certificate relationships
- fresh-schema portable PGlite transfer test after generated migrations are ordered uniqueness-first, foreign-keys-second
- native Bun high-severity audit with no advisories or suppressions
- Go 1.25.13 `govulncheck` scans for `apps/docker-broker` and `apps/monitoring` (zero reachable vulnerabilities)
- operational-status rehearsal restore-verification gate test and internal Docker-control-network acceptance contracts
- stable tag release acceptance defaulting to the full recovery/load profile, with a contract test preventing smoke from becoming the tag-push default
- Changesets release metadata validation reporting the fixed deployable set (`server`, `schedules`, `web`, and `fumadocs`) for the next patch release
- server URL-resolution tests covering malformed Host authorities, spoofed forwarded host/protocol headers, arbitrary public Host fallback, and direct-IP bootstrap routing

Concerning or operationally incomplete:

- `bash scripts/security-audit.sh` now passes; its Git Bash fallback resolves `bun.exe` and reports no vulnerabilities
- The DMG maker is no longer produced; macOS release validation must continue to verify the supported ZIP artifact.
- TESTING.md is referenced by repository guidance but is absent at the repository root; package READMEs and CI/test configuration were used instead.
- control-plane transfer HTTP boundary validation tests covering strict owner/export schemas, bounded passphrases, exact confirmations, bounded target IDs, and whitespace-preserving import/export passphrases
- portable secret-bundle tests covering KDF passphrase bounds, whitespace-only rejection, and exact-character encryption/decryption

The existing security_best_practices_report.md was treated as historical evidence only because it targets an older canary snapshot. A pre-existing unrelated modification to .codex/config.toml was preserved.

## Final Verdict

**NOT PRODUCTION READY.**

The codebase is a credible, actively hardened pre-production platform, but the remaining broad host-control paths, installation-specific recovery evidence, worker toolchain blast radius, and incomplete operational evidence remain release-blocking. Production approval should require the top blockers to be closed or backed by explicit owners, compensating controls, dated remediation plans, and recorded operational evidence.
