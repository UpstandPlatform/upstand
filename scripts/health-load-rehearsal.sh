#!/usr/bin/env sh
set -eu

TARGET_URL="${1:-http://upstand_server:3000}"
REQUESTS="${HEALTH_LOAD_REQUESTS:-120}"
CONCURRENCY="${HEALTH_LOAD_CONCURRENCY:-12}"
MAX_FAILURES="${HEALTH_LOAD_MAX_FAILURES:-0}"
REQUEST_TIMEOUT_SECONDS="${HEALTH_LOAD_REQUEST_TIMEOUT_SECONDS:-10}"
MAX_P95_MS="${HEALTH_LOAD_MAX_P95_MS:-}"
MAX_P99_MS="${HEALTH_LOAD_MAX_P99_MS:-}"
REQUEST_PATH="${HEALTH_LOAD_REQUEST_PATH:-}"
AUTH_HEADER="${HEALTH_LOAD_AUTH_HEADER:-}"

fail() {
  echo "health-load-rehearsal: $*" >&2
  exit 1
}

case "$TARGET_URL" in
  http://*|https://*) ;;
  *) fail "target URL must use http:// or https://" ;;
esac
case "$TARGET_URL" in
  *://*@*) fail "target URL must not contain embedded credentials" ;;
esac

if [ -n "$REQUEST_PATH" ]; then
  case "$REQUEST_PATH" in
    /*) ;;
    *) fail "HEALTH_LOAD_REQUEST_PATH must start with /" ;;
  esac
fi

if [ -n "$AUTH_HEADER" ]; then
  case "$AUTH_HEADER" in
    *:*) ;;
    *) fail "HEALTH_LOAD_AUTH_HEADER must be a complete HTTP header" ;;
  esac
fi

is_bounded_integer() {
  value="$1"
  minimum="$2"
  maximum="$3"
  case "$value" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$value" -ge "$minimum" ] 2>/dev/null && [ "$value" -le "$maximum" ] 2>/dev/null
}

is_bounded_integer "$REQUESTS" 1 10000 \
  || fail "HEALTH_LOAD_REQUESTS must be an integer from 1 to 10000"
is_bounded_integer "$CONCURRENCY" 1 100 \
  || fail "HEALTH_LOAD_CONCURRENCY must be an integer from 1 to 100"
is_bounded_integer "$MAX_FAILURES" 0 "$REQUESTS" \
  || fail "HEALTH_LOAD_MAX_FAILURES must be an integer from 0 to $REQUESTS"
is_bounded_integer "$REQUEST_TIMEOUT_SECONDS" 1 60 \
  || fail "HEALTH_LOAD_REQUEST_TIMEOUT_SECONDS must be an integer from 1 to 60"
if [ -n "$MAX_P95_MS" ]; then
  is_bounded_integer "$MAX_P95_MS" 0 600000 \
    || fail "HEALTH_LOAD_MAX_P95_MS must be an integer from 0 to 600000"
fi
if [ -n "$MAX_P99_MS" ]; then
  is_bounded_integer "$MAX_P99_MS" 0 600000 \
    || fail "HEALTH_LOAD_MAX_P99_MS must be an integer from 0 to 600000"
fi

temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/upstand-health-load.XXXXXX")"
trap 'rm -rf "$temporary_root"' 0 1 2 3 15

request_worker() {
  worker_id="$1"
  request_id="$worker_id"

  while [ "$request_id" -le "$REQUESTS" ]; do
    if [ -n "$REQUEST_PATH" ]; then
      path="$REQUEST_PATH"
    elif [ $((request_id % 2)) -eq 0 ]; then
      path="/health/live"
    else
      path="/health/ready"
    fi

    set +e
    if [ -n "$AUTH_HEADER" ]; then
      result="$(curl --silent --show-error --output /dev/null \
        --connect-timeout "$REQUEST_TIMEOUT_SECONDS" \
        --max-time "$REQUEST_TIMEOUT_SECONDS" \
        --write-out '%{http_code} %{time_total}' \
        --header "$AUTH_HEADER" \
        "${TARGET_URL%/}${path}" 2>/dev/null)"
    else
      result="$(curl --silent --show-error --output /dev/null \
        --connect-timeout "$REQUEST_TIMEOUT_SECONDS" \
        --max-time "$REQUEST_TIMEOUT_SECONDS" \
        --write-out '%{http_code} %{time_total}' \
        "${TARGET_URL%/}${path}" 2>/dev/null)"
    fi
    curl_status=$?
    set -e

    if [ "$curl_status" -ne 0 ] || ! printf '%s\n' "$result" | grep -Eq '^[0-9]{3}[[:space:]][0-9]+(\.[0-9]+)?$'; then
      printf '000 0\n' >> "$temporary_root/results.$worker_id"
    else
      printf '%s\n' "$result" >> "$temporary_root/results.$worker_id"
    fi
    request_id=$((request_id + CONCURRENCY))
  done
}

worker_pids=""
worker_id=1
while [ "$worker_id" -le "$CONCURRENCY" ]; do
  request_worker "$worker_id" &
  worker_pids="$worker_pids $!"
  worker_id=$((worker_id + 1))
done

for worker_pid in $worker_pids; do
  wait "$worker_pid"
done

cat "$temporary_root"/results.* > "$temporary_root/results"
total="$(wc -l < "$temporary_root/results" | tr -d '[:space:]')"
[ "$total" = "$REQUESTS" ] || fail "expected $REQUESTS results, received $total"

failures="$(awk '$1 !~ /^2[0-9][0-9]$/ { count++ } END { print count + 0 }' "$temporary_root/results")"
[ "$failures" -le "$MAX_FAILURES" ] \
  || fail "$failures of $total health requests failed (maximum allowed: $MAX_FAILURES)"

set +e
metrics="$(sort -n -k2 "$temporary_root/results" | awk \
  -v target_url="$TARGET_URL" -v concurrency="$CONCURRENCY" -v failures="$failures" \
  -v max_p95_ms="$MAX_P95_MS" -v max_p99_ms="$MAX_P99_MS" '
  function percentile(percent, position) {
    position = int((count * percent) + 0.999999);
    if (position < 1) position = 1;
    if (position > count) position = count;
    return values[position];
  }
  { values[++count] = $2 * 1000 }
  END {
    if (count == 0) exit 1;
    p50 = percentile(0.50)
    p95 = percentile(0.95)
    p99 = percentile(0.99)
    p95_limit = (max_p95_ms != "") ? (max_p95_ms + 0) : -1
    p99_limit = (max_p99_ms != "") ? (max_p99_ms + 0) : -1
    printf "health-load-rehearsal: target=%s requests=%d concurrency=%d failures=%d p50_ms=%.3f p95_ms=%.3f p99_ms=%.3f max_p95_ms=%s max_p99_ms=%s\n", \
      target_url, count, concurrency, failures, p50, p95, p99, (p95_limit >= 0 ? max_p95_ms : "none"), (p99_limit >= 0 ? max_p99_ms : "none")
    if ((p95_limit >= 0 && p95 > p95_limit) || (p99_limit >= 0 && p99 > p99_limit)) exit 2
  }
')"
metrics_status=$?
set -e
printf '%s\n' "$metrics"
if [ "$metrics_status" -eq 1 ]; then
  fail "could not calculate latency percentiles"
elif [ "$metrics_status" -eq 2 ]; then
  fail "latency SLO exceeded (p95 limit: ${MAX_P95_MS}ms, p99 limit: ${MAX_P99_MS}ms)"
elif [ "$metrics_status" -ne 0 ]; then
  fail "latency measurement failed"
fi
