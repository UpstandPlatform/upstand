#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
STABLE_WORKFLOW="$ROOT_DIR/.github/workflows/stable-tag.yml"
RELEASE_WORKFLOW="$ROOT_DIR/.github/workflows/release.yml"
RECOVERY_WORKFLOW="$ROOT_DIR/.github/workflows/release-recovery-rehearsal.yml"

require_text() {
  local file="$1"
  local text="$2"
  grep -Fq -- "$text" "$file" || {
    echo "release orchestration contract is missing '$text' in $file" >&2
    exit 1
  }
}

require_text "$RELEASE_WORKFLOW" "tags:"
require_text "$RELEASE_WORKFLOW" "- 'v*'"
require_text "$STABLE_WORKFLOW" 'gh workflow run "Publish CLI Package"'
if grep -Fq -- 'Dispatch Release and Publish Docker Images' "$STABLE_WORKFLOW"; then
  echo "stable-tag must not dispatch Docker publication in addition to the tag trigger" >&2
  exit 1
fi

require_text "$RELEASE_WORKFLOW" "release:desktop-version"
require_text "$RELEASE_WORKFLOW" 'release:desktop-version -- "${{ inputs.release_ref || github.ref }}"'
require_text "$RECOVERY_WORKFLOW" 'cron: "17 3 * * 1"'
require_text "$RECOVERY_WORKFLOW" "build_images: false"
require_text "$RECOVERY_WORKFLOW" "git ls-remote --tags --refs"

for dockerfile in \
  "$ROOT_DIR/apps/server/Dockerfile" \
  "$ROOT_DIR/apps/schedules/Dockerfile" \
  "$ROOT_DIR/apps/web/Dockerfile" \
  "$ROOT_DIR/apps/fumadocs/Dockerfile" \
  "$ROOT_DIR/apps/monitoring/Dockerfile"; do
  require_text "$dockerfile" 'org.opencontainers.image.version'
  require_text "$dockerfile" 'org.opencontainers.image.revision'
done

require_text "$RELEASE_WORKFLOW" 'scope=release-${{ matrix.scope }}'
require_text "$ROOT_DIR/.github/workflows/canary.yml" 'scope: canary-upstand-server'
require_text "$ROOT_DIR/.github/workflows/ci.yml" 'scope=ci-${{ github.event_name }}-${{ matrix.name }}'

echo "release-orchestration-contract: passed"
