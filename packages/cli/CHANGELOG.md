# @upstand/cli

## 0.2.4

### Patch Changes

- [#265](https://github.com/UpstandPlatform/upstand/pull/265) [`c000108`](https://github.com/UpstandPlatform/upstand/commit/c000108342fdd1fde23d1c77849627841a417ad1) Thanks [@mhbdev](https://github.com/mhbdev)! - Make direct IP recovery access resolve to the same-host API, expose complete local topology only to the cloud instance owner, prevent cloud and desktop bare runtimes from reaching local Docker surfaces, and make Desktop default to Upstand Cloud with an explicit local bare-mode opt-in.

## 0.2.3

### Patch Changes

- [#262](https://github.com/UpstandPlatform/upstand/pull/262) [`95c8817`](https://github.com/UpstandPlatform/upstand/commit/95c88178badb0a60ad004787723638f5a3d0828e) Thanks [@mhbdev](https://github.com/mhbdev)! - Hide unavailable Google sign-in, support password setup and passwordless 2FA
  for social accounts, preserve CLI device-login URLs on Windows, and refresh
  authentication, runtime-channel, release, and self-hosting documentation.

## 0.2.2

### Patch Changes

- [#245](https://github.com/UpstandPlatform/upstand/pull/245) [`9d82f72`](https://github.com/UpstandPlatform/upstand/commit/9d82f72ec1ac05c139129de815d9fca3df8d1d40) Thanks [@mhbdev](https://github.com/mhbdev)! - Keep one-shot CLI output visible in terminal scrollback instead of clearing it on exit.

## 0.2.1

### Patch Changes

- [#236](https://github.com/UpstandPlatform/upstand/pull/236) [`4803a37`](https://github.com/UpstandPlatform/upstand/commit/4803a37aec55d30436a1e8a6dc5b4db147f5b377) Thanks [@mhbdev](https://github.com/mhbdev)! - Fix the published CLI package so its runtime Zod dependency uses a registry-resolvable semver range.

## 0.2.0

### Minor Changes

- [#227](https://github.com/UpstandPlatform/upstand/pull/227) [`d0afa63`](https://github.com/UpstandPlatform/upstand/commit/d0afa639de1a1c2cca58410947d43057a91927c6) Thanks [@mhbdev](https://github.com/mhbdev)! - Add production deployment plans and capability policy, resumable workload and control-plane migration workflows, portable encrypted transfers, correlated operational telemetry, GitHub diagnostics, operator runbooks, and matching dashboard and CLI controls.

## 0.1.2

### Patch Changes

- [#187](https://github.com/UpstandPlatform/upstand/pull/187) [`7aaf847`](https://github.com/UpstandPlatform/upstand/commit/7aaf8477ee95301f411bdce39abd463c082687b6) Thanks [@mhbdev](https://github.com/mhbdev)! - Publish CLI releases automatically from trusted GitHub Actions OIDC credentials with npm provenance and immutable-content retry checks.

## 0.1.1

### Patch Changes

- [#134](https://github.com/UpstandPlatform/upstand/pull/134) [`8f7ded3`](https://github.com/UpstandPlatform/upstand/commit/8f7ded3d4ff2be23eadfaf2151d20fb711ee0756) Thanks [@mhbdev](https://github.com/mhbdev)! - Add the OpenTUI-powered Upstand command-line interface with project linking,
  deployment workflows, deployment logs, JSON output, CI token support, and a
  generic typed API procedure command.
