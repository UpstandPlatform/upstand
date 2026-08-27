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

echo "backup-restore-rehearsal-contract: passed"
