#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET_URL="${1:-http://upstand_server:3000}"
DURATION_SECONDS="${HEALTH_SOAK_DURATION_SECONDS:-600}"
WINDOW_REQUESTS="${HEALTH_SOAK_WINDOW_REQUESTS:-120}"
WINDOW_CONCURRENCY="${HEALTH_SOAK_WINDOW_CONCURRENCY:-12}"
MAX_FAILURES_PER_WINDOW="${HEALTH_SOAK_MAX_FAILURES_PER_WINDOW:-0}"
MAX_P95_MS="${HEALTH_SOAK_MAX_P95_MS:-0}"
MAX_P99_MS="${HEALTH_SOAK_MAX_P99_MS:-0}"
MAX_WINDOWS="${HEALTH_SOAK_MAX_WINDOWS:-10000}"
REQUEST_TIMEOUT_SECONDS="${HEALTH_LOAD_REQUEST_TIMEOUT_SECONDS:-10}"
REQUEST_PATH="${HEALTH_LOAD_REQUEST_PATH:-}"
AUTH_HEADER="${HEALTH_LOAD_AUTH_HEADER:-}"
OUTPUT_FILE="${HEALTH_SOAK_OUTPUT_FILE:-}"

fail() {
  echo "health-soak-rehearsal: $*" >&2
  exit 1
}

case "$TARGET_URL" in
  http://*|https://*) ;;
  *) fail "target URL must use http:// or https://" ;;
esac
case "$TARGET_URL" in
  *://*@*) fail "target URL must not contain embedded credentials" ;;
esac

is_bounded_integer() {
  value="$1"
  minimum="$2"
  maximum="$3"
  case "$value" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$value" -ge "$minimum" ] 2>/dev/null && [ "$value" -le "$maximum" ] 2>/dev/null
}

is_bounded_integer "$DURATION_SECONDS" 10 86400 \
  || fail "HEALTH_SOAK_DURATION_SECONDS must be an integer from 10 to 86400"
is_bounded_integer "$WINDOW_REQUESTS" 1 10000 \
  || fail "HEALTH_SOAK_WINDOW_REQUESTS must be an integer from 1 to 10000"
is_bounded_integer "$WINDOW_CONCURRENCY" 1 100 \
  || fail "HEALTH_SOAK_WINDOW_CONCURRENCY must be an integer from 1 to 100"
is_bounded_integer "$MAX_FAILURES_PER_WINDOW" 0 "$WINDOW_REQUESTS" \
  || fail "HEALTH_SOAK_MAX_FAILURES_PER_WINDOW must be an integer from 0 to $WINDOW_REQUESTS"
is_bounded_integer "$MAX_P95_MS" 0 600000 \
  || fail "HEALTH_SOAK_MAX_P95_MS must be an integer from 0 to 600000"
is_bounded_integer "$MAX_P99_MS" 0 600000 \
  || fail "HEALTH_SOAK_MAX_P99_MS must be an integer from 0 to 600000"
is_bounded_integer "$MAX_WINDOWS" 1 10000 \
  || fail "HEALTH_SOAK_MAX_WINDOWS must be an integer from 1 to 10000"
is_bounded_integer "$REQUEST_TIMEOUT_SECONDS" 1 60 \
  || fail "HEALTH_LOAD_REQUEST_TIMEOUT_SECONDS must be an integer from 1 to 60"

temporary_root=$(mktemp -d "${TMPDIR:-/tmp}/upstand-health-soak.XXXXXX")
trap 'rm -rf "$temporary_root"' 0 1 2 3 15

if [ -n "$OUTPUT_FILE" ]; then
  case "$OUTPUT_FILE" in
    /*) ;;
    *) fail "HEALTH_SOAK_OUTPUT_FILE must be an absolute path" ;;
  esac
  output_parent=$(dirname -- "$OUTPUT_FILE")
  [ -d "$output_parent" ] || fail "output directory does not exist: $output_parent"
  umask 077
  : > "$OUTPUT_FILE"
  output_target="$OUTPUT_FILE"
else
  umask 077
  output_target="${TMPDIR:-/tmp}/upstand-health-soak.$$.txt"
  : > "$output_target"
fi

write_output() {
  tee -a "$output_target"
}

start_epoch=$(date +%s)
deadline=$((start_epoch + DURATION_SECONDS))
window=0
total_requests=0

printf 'health-soak-rehearsal: target=%s duration_seconds=%s window_requests=%s window_concurrency=%s max_failures_per_window=%s max_p95_ms=%s max_p99_ms=%s max_windows=%s\n' \
  "$TARGET_URL" "$DURATION_SECONDS" "$WINDOW_REQUESTS" "$WINDOW_CONCURRENCY" \
  "$MAX_FAILURES_PER_WINDOW" "$MAX_P95_MS" "$MAX_P99_MS" "$MAX_WINDOWS" | write_output

while [ "$(date +%s)" -lt "$deadline" ] && [ "$window" -lt "$MAX_WINDOWS" ]; do
  window=$((window + 1))
  window_start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf 'window=%s started_at=%s\n' "$window" "$window_start" | write_output

  window_output="$temporary_root/window-$window.txt"
  set +e
  HEALTH_LOAD_REQUESTS="$WINDOW_REQUESTS" \
    HEALTH_LOAD_CONCURRENCY="$WINDOW_CONCURRENCY" \
    HEALTH_LOAD_MAX_FAILURES="$MAX_FAILURES_PER_WINDOW" \
    HEALTH_LOAD_REQUEST_TIMEOUT_SECONDS="$REQUEST_TIMEOUT_SECONDS" \
    HEALTH_LOAD_MAX_P95_MS="$MAX_P95_MS" \
    HEALTH_LOAD_MAX_P99_MS="$MAX_P99_MS" \
    HEALTH_LOAD_REQUEST_PATH="$REQUEST_PATH" \
    HEALTH_LOAD_AUTH_HEADER="$AUTH_HEADER" \
    sh "$SCRIPT_DIR/health-load-rehearsal.sh" "$TARGET_URL" > "$window_output" 2>&1
  window_status=$?
  set -e
  cat "$window_output" | write_output
  rm -f "$window_output"
  total_requests=$((total_requests + WINDOW_REQUESTS))
  if [ "$window_status" -ne 0 ]; then
    printf 'window=%s status=failed exit_code=%s\n' "$window" "$window_status" | write_output
    fail "soak window $window failed; evidence=$output_target"
  fi
  printf 'window=%s status=passed\n' "$window" | write_output
done

[ "$window" -ge 1 ] || fail "soak duration elapsed before a load window could run"
printf 'health-soak-rehearsal: passed windows=%s requests=%s evidence=%s\n' \
  "$window" "$total_requests" "$output_target" | write_output
