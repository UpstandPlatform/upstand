# server

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
