#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
STABLE_WORKFLOW="$ROOT_DIR/.github/workflows/stable-tag.yml"
RELEASE_WORKFLOW="$ROOT_DIR/.github/workflows/release.yml"
RECOVERY_WORKFLOW="$ROOT_DIR/.github/workflows/release-recovery-rehearsal.yml"
OWNER_ROUTE="$ROOT_DIR/apps/server/src/http/routes/control-plane-transfer.ts"

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
require_text "$STABLE_WORKFLOW" "github.ref == 'refs/heads/master'"
if grep -Fq -- 'Dispatch Release and Publish Docker Images' "$STABLE_WORKFLOW"; then
  echo "stable-tag must not dispatch Docker publication in addition to the tag trigger" >&2
  exit 1
fi

require_text "$RELEASE_WORKFLOW" "release:desktop-version"
require_text "$RELEASE_WORKFLOW" 'release:desktop-version -- "${{ inputs.release_ref || github.ref }}"'
require_text "$RECOVERY_WORKFLOW" 'cron: "17 3 * * 1"'
require_text "$RECOVERY_WORKFLOW" "build_images: false"
require_text "$RECOVERY_WORKFLOW" "git ls-remote --tags --refs"

# Legacy owner recovery must remain an explicit, step-up-protected,
# compare-and-set operation rather than a silent authorization fallback.
require_text "$OWNER_ROUTE" 'app.post("/api/control-plane-transfer/owner/repair"'
require_text "$OWNER_ROUTE" 'REPAIR_INSTANCE_OWNERSHIP'
require_text "$OWNER_ROUTE" 'isNull(controlPlaneIdentity.ownerUserId)'
require_text "$OWNER_ROUTE" 'operation: "configure"'
require_text "$ROOT_DIR/docker-compose.prod.yml" 'DOCKER_HOST: https://docker-broker:2375'
require_text "$ROOT_DIR/docker-compose.prod.yml" 'UPSTAND_DOCKER_BROKER_TLS_REQUIRED: "true"'
require_text "$ROOT_DIR/.github/workflows/ci.yml" 'go test -race ./...'
require_text "$ROOT_DIR/.github/workflows/ci.yml" 'go vet ./...'
require_text "$ROOT_DIR/docker-compose.prod.yml" 'docker_broker_server_client_cert'
require_text "$ROOT_DIR/docker-compose.prod.yml" 'docker_broker_schedules_client_cert'
require_text "$ROOT_DIR/docker-compose.prod.yml" 'docker_broker_deployment_worker_client_cert'

# The API server is a long-lived control-plane process, not the build worker.
# Keep builder-specific binaries out of the orchestration runtime image. The
# deployment worker is the explicit build executor and retains those tools.
for forbidden in \
  'FROM buildpacksio/pack:' \
  'FROM docker/buildx-bin:' \
  'NIXPACKS_VERSION=' \
  'COPY --from=buildpacks' \
  'COPY --from=buildx' \
  'docker buildx version' \
  'install /usr/local/bin/nixpacks'; do
  if grep -Fq -- "$forbidden" "$ROOT_DIR/apps/server/Dockerfile"; then
    echo "server runtime Dockerfile must not include builder toolchain: $forbidden" >&2
    exit 1
  fi
done
require_text "$ROOT_DIR/apps/schedules/Dockerfile.worker" 'FROM buildpacksio/pack:'
require_text "$ROOT_DIR/apps/schedules/Dockerfile.worker" 'FROM docker/buildx-bin:'
require_text "$ROOT_DIR/apps/schedules/Dockerfile.worker" 'NIXPACKS_VERSION='
for forbidden in \
  'FROM buildpacksio/pack:' \
  'FROM docker/buildx-bin:' \
  'NIXPACKS_VERSION=' \
  'COPY --from=buildpacks' \
  'COPY --from=buildx' \
  'install /usr/local/bin/nixpacks' \
  'openssh-client' \
  ' g++'; do
  if grep -Fq -- "$forbidden" "$ROOT_DIR/apps/schedules/Dockerfile"; then
    echo "schedules orchestrator Dockerfile must not include deployment build tooling: $forbidden" >&2
    exit 1
  fi
done

for dockerfile in \
  "$ROOT_DIR/apps/server/Dockerfile" \
  "$ROOT_DIR/apps/schedules/Dockerfile" \
  "$ROOT_DIR/apps/schedules/Dockerfile.worker" \
  "$ROOT_DIR/apps/web/Dockerfile" \
  "$ROOT_DIR/apps/fumadocs/Dockerfile" \
  "$ROOT_DIR/apps/monitoring/Dockerfile" \
  "$ROOT_DIR/apps/docker-broker/Dockerfile"; do
  require_text "$dockerfile" 'org.opencontainers.image.version'
  require_text "$dockerfile" 'org.opencontainers.image.revision'
done

require_text "$RELEASE_WORKFLOW" 'scope=release-${{ matrix.scope }}'
require_text "$ROOT_DIR/.github/workflows/canary.yml" 'scope: canary-upstand-server'
require_text "$ROOT_DIR/.github/workflows/ci.yml" 'scope=ci-${{ github.event_name }}-${{ matrix.name }}'
require_text "$ROOT_DIR/.github/workflows/canary.yml" 'artifact-metadata: write'
require_text "$ROOT_DIR/.github/workflows/release-dispatch.yml" 'artifact-metadata: write'
require_text "$ROOT_DIR/.github/workflows/release-recovery-rehearsal.yml" 'artifact-metadata: write'

echo "release-orchestration-contract: passed"
