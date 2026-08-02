#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$root_dir/scripts/health-load-rehearsal.sh"
release_workflow="$root_dir/.github/workflows/release.yml"

require_script_text() {
  local text="$1"
  grep -Fq -- "$text" "$script" || {
    echo "missing health-load rehearsal contract: $text" >&2
    exit 1
  }
}

require_workflow_text() {
  local text="$1"
  grep -Fq -- "$text" "$release_workflow" || {
    echo "missing release health-load contract: $text" >&2
    exit 1
  }
}

require_script_text 'TARGET_URL="${1:-http://upstand_server:3000}"'
require_script_text 'HEALTH_LOAD_REQUESTS'
require_script_text '1 to 10000'
require_script_text 'HEALTH_LOAD_CONCURRENCY'
require_script_text 'HEALTH_LOAD_MAX_FAILURES'
require_script_text 'HEALTH_LOAD_REQUEST_TIMEOUT_SECONDS'
require_script_text 'HEALTH_LOAD_MAX_P95_MS'
require_script_text 'HEALTH_LOAD_MAX_P99_MS'
require_script_text 'HEALTH_LOAD_REQUEST_PATH'
require_script_text 'HEALTH_LOAD_AUTH_HEADER'
require_script_text '--header "$AUTH_HEADER"'
require_script_text 'must be a complete HTTP header'
require_script_text 'must not contain embedded credentials'
require_script_text '/health/live'
require_script_text '/health/ready'
require_script_text 'p95_ms'
require_script_text 'p99_ms'
require_script_text 'rm -rf "$temporary_root"'
require_workflow_text 'HEALTH_LOAD_IMAGE: curlimages/curl:8.16.0@sha256:463eaf6072688fe96ac64fa623fe73e1dbe25d8ad6c34404a669ad3ce1f104b6'
require_workflow_text 'scripts/health-load-rehearsal.sh'
require_workflow_text '--cap-drop ALL'
require_workflow_text '--read-only'

echo "health-load-rehearsal-contract: passed"
