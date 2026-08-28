#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/backup-restore-rehearsal.sh"

require_script_text() {
  local text="$1"
  grep -Fq -- "$text" "$SCRIPT" || {
    echo "backup rehearsal is missing required contract: $text" >&2
    exit 1
  }
}

require_script_text 'minio/minio@sha256:'
require_script_text 'postgres:18-alpine@sha256:'
require_script_text 'alpine:3.20@sha256:'
require_script_text 'command "$DOCKER_BIN" "$@"'
require_script_text 'server_image" =~ @sha256:'
require_script_text 'UPSTAND_BACKUP_REHEARSAL_RUN_ID must be a bounded alphanumeric identifier'
require_script_text 'backup rehearsal image must be a bounded immutable image reference'
require_script_text '--env RCLONE_CONFIG=/dev/null'
require_script_text 'docker network create "$network"'
require_script_text 'name=^${name}$'
require_script_text 'rm -rf -- "$temporary_root"'
require_script_text 'pg_restore -U postgres -d acceptance --clean --if-exists --no-owner'
require_script_text 'SELECT marker FROM readiness_probe WHERE id = 1'
require_script_text 'UPSTAND_BACKUP_REHEARSAL_MAX_TOTAL_SECONDS'
require_script_text 'UPSTAND_BACKUP_REHEARSAL_MAX_RESTORE_SECONDS'
require_script_text 'assert_budget restore'
require_script_text 'readiness_seconds='
require_script_text 'restore_seconds='
require_script_text 'backup-restore-rehearsal: passed'
require_script_text '  "scope": "synthetic-disposable",'

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_DIR"' EXIT
valid_image="ghcr.io/upstandplatform/upstand-server:v0.2.26@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

if UPSTAND_BACKUP_REHEARSAL_RUN_ID='bad evidence id' \
  UPSTAND_BACKUP_REHEARSAL_IMAGE="$valid_image" \
  DOCKER_BIN=true \
  bash "$SCRIPT" >"$TEMP_DIR/run-id.out" 2>"$TEMP_DIR/run-id.err"; then
  echo "backup rehearsal unexpectedly accepted an unsafe run ID" >&2
  exit 1
fi
grep -Fq -- 'bounded alphanumeric identifier' "$TEMP_DIR/run-id.err" || {
  echo "backup rehearsal did not reject an unsafe run ID with the expected error" >&2
  exit 1
}

if UPSTAND_BACKUP_REHEARSAL_RUN_ID='safe-id' \
  UPSTAND_BACKUP_REHEARSAL_IMAGE="ghcr.io/upstandplatform/upstand-server:bad image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
  DOCKER_BIN=true \
  bash "$SCRIPT" >"$TEMP_DIR/image.out" 2>"$TEMP_DIR/image.err"; then
  echo "backup rehearsal unexpectedly accepted an unsafe image reference" >&2
  exit 1
fi
grep -Fq -- 'bounded immutable image reference' "$TEMP_DIR/image.err" || {
  echo "backup rehearsal did not reject an unsafe image reference with the expected error" >&2
  exit 1
}

echo "backup-restore-rehearsal-contract: passed"
