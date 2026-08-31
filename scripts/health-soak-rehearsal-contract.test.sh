#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$root_dir/scripts/health-soak-rehearsal.sh"

require_script_text() {
  local text="$1"
  grep -Fq -- "$text" "$script" || {
    echo "missing health-soak rehearsal contract: $text" >&2
    exit 1
  }
}

require_script_text 'HEALTH_SOAK_DURATION_SECONDS'
require_script_text 'HEALTH_SOAK_WINDOW_REQUESTS'
require_script_text 'HEALTH_SOAK_WINDOW_CONCURRENCY'
require_script_text 'HEALTH_SOAK_MAX_FAILURES_PER_WINDOW'
require_script_text 'HEALTH_SOAK_MAX_P95_MS'
require_script_text 'HEALTH_SOAK_MAX_P99_MS'
require_script_text 'MAX_P95_MS="${HEALTH_SOAK_MAX_P95_MS-}"'
require_script_text 'MAX_P99_MS="${HEALTH_SOAK_MAX_P99_MS-}"'
require_script_text 'if [ -n "$MAX_P95_MS" ]; then'
require_script_text 'if [ -n "$MAX_P99_MS" ]; then'
require_script_text 'HEALTH_SOAK_MAX_WINDOWS'
require_script_text 'HEALTH_SOAK_OUTPUT_FILE'
require_script_text 'HEALTH_LOAD_REQUEST_PATH'
require_script_text 'HEALTH_LOAD_AUTH_HEADER'
require_script_text 'health-load-rehearsal.sh'
require_script_text 'must not contain embedded credentials'
require_script_text 'rm -rf "$temporary_root"'

echo "health-soak-rehearsal-contract: passed"
