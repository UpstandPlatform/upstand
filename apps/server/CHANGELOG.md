# server

## 0.2.22

### Patch Changes

- Fix direct IP and port runtime URL resolution and trust direct host IP origins for CORS and session authentication on cloud and self-hosted runtimes.

## 0.2.21

## 0.2.20

## 0.2.19

## 0.2.18

## 0.2.17

### Patch Changes

- [#290](https://github.com/UpstandPlatform/upstand/pull/290) [`13dc591`](https://github.com/UpstandPlatform/upstand/commit/13dc591ad4d1161e462d6d32cc318e0525b9426c) Thanks [@mhbdev](https://github.com/mhbdev)! - Harden container file management around explicitly selected full container IDs and named Docker volumes. File operations are now mount-scoped, symlink-safe, bounded, binary-safe, atomic for writes, and reject read-only or non-canonical targets. The release also removes runtime compatibility paths that accepted legacy labels, plaintext secret documents, abbreviated container IDs, legacy installer artifacts, and non-paginated backup adapters.

## 0.2.16

### Patch Changes

- [#288](https://github.com/UpstandPlatform/upstand/pull/288) [`55789af`](https://github.com/UpstandPlatform/upstand/commit/55789af2e7633c5655820af24b5f0c67a3d139b7) Thanks [@mhbdev](https://github.com/mhbdev)! - Fix mobile provider dialogs and make GitHub App manifest installation callbacks
  reliable across cloud and self-hosted runtimes.

## 0.2.15

### Patch Changes

- [#286](https://github.com/UpstandPlatform/upstand/pull/286) [`ea7d678`](https://github.com/UpstandPlatform/upstand/commit/ea7d678185fceb73efcdb0eda5498e042471d6a1) Thanks [@mhbdev](https://github.com/mhbdev)! - Make local self-hosted and cloud development runtimes safely switchable with isolated persistent state, and add a disposable Multipass remote-server lab for end-to-end provisioning tests.

## 0.2.14

### Patch Changes

- [#280](https://github.com/UpstandPlatform/upstand/pull/280) [`21eb71d`](https://github.com/UpstandPlatform/upstand/commit/21eb71d1bc6b37dca880d21e86339f704f1cecaa) Thanks [@mhbdev](https://github.com/mhbdev)! - Publish the CLI browser-login and interactive resource-selection fixes in the next Upstand patch release.

## 0.2.13

### Patch Changes

- [#275](https://github.com/UpstandPlatform/upstand/pull/275) [`743d046`](https://github.com/UpstandPlatform/upstand/commit/743d0462614856bf7a4cb032d1da7c501c984278) Thanks [@mhbdev](https://github.com/mhbdev)! - Remove a duplicate internal error-message helper, make the signed-in dashboard
  resolve its capability surface before rendering navigation, improve environment
  comparison and promotion workflows, enforce server-side dashboard session
  checks before protected pages render, and remove redundant local Docker script
  aliases plus repository-local agent skills.

## 0.2.12

### Patch Changes

- Harden release packaging and keep internal monitoring collection failures out of the public health response.

## 0.2.11

## 0.2.10

### Patch Changes

- [#269](https://github.com/UpstandPlatform/upstand/pull/269) [`5f68c89`](https://github.com/UpstandPlatform/upstand/commit/5f68c89ecfc645bff49149ac7413d62c6957efbb) Thanks [@mhbdev](https://github.com/mhbdev)! - Keep long-running control-plane services recoverable after transient Docker Swarm node or agent interruptions by removing finite restart-attempt limits from the production stack.

## 0.2.9

### Patch Changes

- [#267](https://github.com/UpstandPlatform/upstand/pull/267) [`113086f`](https://github.com/UpstandPlatform/upstand/commit/113086f79b8768b083dc16fa38cf42cc53db03d6) Thanks [@mhbdev](https://github.com/mhbdev)! - Allow the cloud instance owner to inspect and trigger managed control-plane updates from the panel while keeping the update surface unavailable to regular cloud users.

## 0.2.8

### Patch Changes

- [#265](https://github.com/UpstandPlatform/upstand/pull/265) [`c000108`](https://github.com/UpstandPlatform/upstand/commit/c000108342fdd1fde23d1c77849627841a417ad1) Thanks [@mhbdev](https://github.com/mhbdev)! - Make direct IP recovery access resolve to the same-host API, expose complete local topology only to the cloud instance owner, prevent cloud and desktop bare runtimes from reaching local Docker surfaces, and make Desktop default to Upstand Cloud with an explicit local bare-mode opt-in.

## 0.2.7

### Patch Changes

- [#262](https://github.com/UpstandPlatform/upstand/pull/262) [`95c8817`](https://github.com/UpstandPlatform/upstand/commit/95c88178badb0a60ad004787723638f5a3d0828e) Thanks [@mhbdev](https://github.com/mhbdev)! - Hide unavailable Google sign-in, support password setup and passwordless 2FA
  for social accounts, preserve CLI device-login URLs on Windows, and refresh
  authentication, runtime-channel, release, and self-hosting documentation.

## 0.2.6

### Patch Changes

- [#260](https://github.com/UpstandPlatform/upstand/pull/260) [`e6d5ba2`](https://github.com/UpstandPlatform/upstand/commit/e6d5ba243552073ca692fc4e72a3913f75a900b2) Thanks [@mhbdev](https://github.com/mhbdev)! - Harden runtime-aware authorization across cloud, desktop, and self-hosted control planes. Stored membership permissions are now constrained to their role scope, instance-only operations require interactive owner sessions, cloud-mode policy is resolved consistently, and control-plane transfer requests are bounded. Cloud users can view request observations from their authorized remote servers without exposing control-plane logs, the first workspace is selected reliably after authentication, member role updates use the shared permission catalog, and the web-server settings surface handles configured cloud domains responsively.

## 0.2.5

### Patch Changes

- [#258](https://github.com/UpstandPlatform/upstand/pull/258) [`0d22592`](https://github.com/UpstandPlatform/upstand/commit/0d22592404ce98b4875617fb811f73a4d5fd87cc) Thanks [@mhbdev](https://github.com/mhbdev)! - Restrict cloud control-plane topology, Docker inventory, request logs, local monitoring, control-plane transfer, and local build/deployment settings to their supported runtimes, promote the first cloud account to instance-owner access, and stabilize GitHub manifest setup.

## 0.2.4

## 0.2.3

## 0.2.2

## 0.2.1

## 0.2.0

### Minor Changes

- [#227](https://github.com/UpstandPlatform/upstand/pull/227) [`d0afa63`](https://github.com/UpstandPlatform/upstand/commit/d0afa639de1a1c2cca58410947d43057a91927c6) Thanks [@mhbdev](https://github.com/mhbdev)! - Add production deployment plans and capability policy, resumable workload and control-plane migration workflows, portable encrypted transfers, correlated operational telemetry, GitHub diagnostics, operator runbooks, and matching dashboard and CLI controls.

## 0.1.55

### Patch Changes

- [#217](https://github.com/UpstandPlatform/upstand/pull/217) [`109fbc4`](https://github.com/UpstandPlatform/upstand/commit/109fbc4da703433f3d9d89a2f4901eb485637f74) Thanks [@mhbdev](https://github.com/mhbdev)! - Harden stable release acceptance and dependency recovery so production images can be verified and published reliably.

## 0.1.54

### Patch Changes

- [#215](https://github.com/UpstandPlatform/upstand/pull/215) [`af0f958`](https://github.com/UpstandPlatform/upstand/commit/af0f9587ef2f7866720dc7faf056ff5baacc2b1c) Thanks [@mhbdev](https://github.com/mhbdev)! - Harden stable release acceptance and dependency recovery so production images can be verified and published reliably.

## 0.1.53

### Patch Changes

- [#206](https://github.com/UpstandPlatform/upstand/pull/206) [`64fe51e`](https://github.com/UpstandPlatform/upstand/commit/64fe51e2203980f68a7ef7a8b4482cd4a882d216) Thanks [@mhbdev](https://github.com/mhbdev)! - Allow the operational status rehearsal to use its writable executable temporary workspace while retaining production read-only hardening.

## 0.1.52

### Patch Changes

- [#204](https://github.com/UpstandPlatform/upstand/pull/204) [`64c2509`](https://github.com/UpstandPlatform/upstand/commit/64c2509a7fc0e7d16c843a4ad1eeffda7ebfcc74) Thanks [@mhbdev](https://github.com/mhbdev)! - Allow the read-only operational rehearsal to use Bun's executable temporary workspace while keeping the production services hardened.

## 0.1.51

### Patch Changes

- [#202](https://github.com/UpstandPlatform/upstand/pull/202) [`798029d`](https://github.com/UpstandPlatform/upstand/commit/798029deabadae4acfe5222eab713b2397282c7a) Thanks [@mhbdev](https://github.com/mhbdev)! - Keep the read-only production operational-status rehearsal compatible with Bun's runtime cache behavior.

## 0.1.50

### Patch Changes

- [#200](https://github.com/UpstandPlatform/upstand/pull/200) [`cd4cd61`](https://github.com/UpstandPlatform/upstand/commit/cd4cd61735f713fa34377f5759ca271e44705a51) Thanks [@mhbdev](https://github.com/mhbdev)! - Use the server liveness endpoint for the container healthcheck so Swarm startup cannot deadlock while schedules waits for the server to bind.

## 0.1.49

### Patch Changes

- [#198](https://github.com/UpstandPlatform/upstand/pull/198) [`21ab4c8`](https://github.com/UpstandPlatform/upstand/commit/21ab4c82b2c9cbe031f87dcbec7b0b85035ce557) Thanks [@mhbdev](https://github.com/mhbdev)! - Initialize the monitoring agent data directory with non-root ownership so its persistent SQLite volume can start successfully under the hardened runtime identity.

## 0.1.48

### Patch Changes

- [#196](https://github.com/UpstandPlatform/upstand/pull/196) [`d681c4d`](https://github.com/UpstandPlatform/upstand/commit/d681c4db3e3f3ac7aa8fa2a96cbeaa90051d40c1) Thanks [@mhbdev](https://github.com/mhbdev)! - Make hosted production acceptance pass the disposable network override to the server and keep the monitoring image healthcheck self-contained.

## 0.1.47

### Patch Changes

- [#194](https://github.com/UpstandPlatform/upstand/pull/194) [`3b1971d`](https://github.com/UpstandPlatform/upstand/commit/3b1971d3658f8571aa7ff3939ccf0be784d67437) Thanks [@mhbdev](https://github.com/mhbdev)! - Reuse an already-present immutable monitoring image during provisioning and pre-pull it in the release acceptance harness, so private GHCR images do not require credentials inside the production container.

## 0.1.46

### Patch Changes

- [#186](https://github.com/UpstandPlatform/upstand/pull/186) [`56ffbb3`](https://github.com/UpstandPlatform/upstand/commit/56ffbb3f52778f2b7c932805a17a371aae6c5dd7) Thanks [@mhbdev](https://github.com/mhbdev)! - Capture bounded server and schedules service logs, health responses, and container state when bundled production acceptance does not converge.

- [#189](https://github.com/UpstandPlatform/upstand/pull/189) [`1567ce5`](https://github.com/UpstandPlatform/upstand/commit/1567ce5ffd2bcd93bef1a961e2a30fdc685ca934) Thanks [@mhbdev](https://github.com/mhbdev)! - Use explicit Swarm-compatible tmpfs mounts so read-only production services retain their required writable temporary paths.

## 0.1.45

### Patch Changes

- [#184](https://github.com/UpstandPlatform/upstand/pull/184) [`d634ddf`](https://github.com/UpstandPlatform/upstand/commit/d634ddf4a6acaa58f9e7a96acd8a09c37a726b52) Thanks [@mhbdev](https://github.com/mhbdev)! - Make production acceptance process-identity checks portable across minimal stateful images.

## 0.1.44

### Patch Changes

- [#182](https://github.com/UpstandPlatform/upstand/pull/182) [`2e50190`](https://github.com/UpstandPlatform/upstand/commit/2e5019068c90055efda1bccb8aff76a260e751ec) Thanks [@mhbdev](https://github.com/mhbdev)! - Prevent the schedules startup gate from deadlocking against server readiness.

## 0.1.43

### Patch Changes

- [#180](https://github.com/UpstandPlatform/upstand/pull/180) [`c885569`](https://github.com/UpstandPlatform/upstand/commit/c885569264e39bc86b24f5e7b104f4f923053f5c) Thanks [@mhbdev](https://github.com/mhbdev)! - Use the runtime available in each production image for web and documentation healthchecks.

## 0.1.42

### Patch Changes

- [#178](https://github.com/UpstandPlatform/upstand/pull/178) [`ed4bc43`](https://github.com/UpstandPlatform/upstand/commit/ed4bc43b0b49472c32084b61be06cb06f8cd3f8e) Thanks [@mhbdev](https://github.com/mhbdev)! - Run bundled service healthchecks as direct Bun commands without shell-dependent quoting.

## 0.1.41

### Patch Changes

- [#176](https://github.com/UpstandPlatform/upstand/pull/176) [`ca350e5`](https://github.com/UpstandPlatform/upstand/commit/ca350e567bf62ecce3ae776ec7dae4b8d0e53fa9) Thanks [@mhbdev](https://github.com/mhbdev)! - Use Bun directly for production healthchecks in the bundled Compose stack.

## 0.1.40

### Patch Changes

- [#174](https://github.com/UpstandPlatform/upstand/pull/174) [`74c56b3`](https://github.com/UpstandPlatform/upstand/commit/74c56b3c46b99673c28084de5b06854895b73b85) Thanks [@mhbdev](https://github.com/mhbdev)! - Use the Bun runtime for bundled API and schedules healthchecks instead of assuming curl is installed.

## 0.1.39

### Patch Changes

- [#172](https://github.com/UpstandPlatform/upstand/pull/172) [`869d43e`](https://github.com/UpstandPlatform/upstand/commit/869d43e45d1592c84b7b419352ce3f39f17d23d7) Thanks [@mhbdev](https://github.com/mhbdev)! - Run the bundled PostgreSQL service as its explicit non-root runtime identity.

## 0.1.38

### Patch Changes

- [#170](https://github.com/UpstandPlatform/upstand/pull/170) [`66a764f`](https://github.com/UpstandPlatform/upstand/commit/66a764f2fb984e1eb1219a969afb7a24648715c5) Thanks [@mhbdev](https://github.com/mhbdev)! - Run the bundled Redis service as its explicit non-root runtime identity.

## 0.1.37

### Patch Changes

- [#168](https://github.com/UpstandPlatform/upstand/pull/168) [`db0646d`](https://github.com/UpstandPlatform/upstand/commit/db0646d55e3f3498c16ef9a2a58aac929b95e6f7) Thanks [@mhbdev](https://github.com/mhbdev)! - Fix production acceptance when stateful images do not provide `ps` for `docker top`.

## 0.1.36

### Patch Changes

- [#160](https://github.com/UpstandPlatform/upstand/pull/160) [`3d87e29`](https://github.com/UpstandPlatform/upstand/commit/3d87e296330ce8b5e2d89d38be6d66d17348aa28) Thanks [@mhbdev](https://github.com/mhbdev)! - Prepare the next stable patch release with the hosted production acceptance and dependency security fixes.

- [#164](https://github.com/UpstandPlatform/upstand/pull/164) [`4dacd2e`](https://github.com/UpstandPlatform/upstand/commit/4dacd2ead09fd1c50093da3362ec0710e130647d) Thanks [@mhbdev](https://github.com/mhbdev)! - Fix production acceptance validation for Docker's normalized capability names.

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

- [#77](https://github.com/UpstandPlatform/upstand/pull/77) [`5f8b7a1`](https://github.com/UpstandPlatform/upstand/commit/5f8b7a1d65bc0a31dbe46e099e6630ae3ea308cc) Thanks [@mhbdev](https://github.com/mhbdev)! - Fix server_id assignment for local manager resources, prevent unassigned server notice in self-hosted mode, and permit unencrypted attachable overlay networks in development environments.

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

### Patch Changes

- [#33](https://github.com/UpstandPlatform/upstand/pull/33) [`e61d707`](https://github.com/UpstandPlatform/upstand/commit/e61d70702646a7adce1c1404fa2fdbd3e59563f8) Thanks [@mhbdev](https://github.com/mhbdev)! - Make the production installer use the latest stable GHCR release images by
  default and resolve them to immutable digests. Source builds remain available
  through an explicit opt-in.

- [#33](https://github.com/UpstandPlatform/upstand/pull/33) [`e61d707`](https://github.com/UpstandPlatform/upstand/commit/e61d70702646a7adce1c1404fa2fdbd3e59563f8) Thanks [@mhbdev](https://github.com/mhbdev)! - Harden service startup and monitoring callbacks, improve local dashboard route
  reliability, and expand authenticated E2E coverage across topology, resource
  configuration, schedules, backups, deployment history, and lifecycle failure
  boundaries.

## 0.1.3

## 0.1.2

### Patch Changes

- [#17](https://github.com/UpstandPlatform/upstand/pull/17) [`5f71f61`](https://github.com/UpstandPlatform/upstand/commit/5f71f619ed6ebb6ef22c7fcd92b5c16792999014) Thanks [@mhbdev](https://github.com/mhbdev)! - Make source-based installations resilient when the Go module proxy returns a temporary or policy-based HTTP error.

## 0.1.1

### Patch Changes

- [#4](https://github.com/UpstandPlatform/upstand/pull/4) [`eda5065`](https://github.com/UpstandPlatform/upstand/commit/eda5065d8e8303033653fdf1d33e09f22b4c5f0c) Thanks [@mhbdev](https://github.com/mhbdev)! - Improve topology visibility, terminal workflows, authorization behavior, and local development verification across the Upstand applications.
