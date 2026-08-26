#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
METRICS_FILE="$ROOT_DIR/apps/schedules/src/health.ts"
SERVER_METRICS_FILE="$ROOT_DIR/apps/server/src/http/server-metrics.ts"
SERVER_ROUTE_FILE="$ROOT_DIR/apps/server/src/http/routes/system.ts"
PROMETHEUS_CONFIG="$ROOT_DIR/ops/observability/prometheus.yml"
ALERT_RULES="$ROOT_DIR/ops/observability/upstand-alerts.yml"
DASHBOARD="$ROOT_DIR/ops/observability/upstand-schedules-dashboard.json"

for file in "$METRICS_FILE" "$SERVER_METRICS_FILE" "$SERVER_ROUTE_FILE" "$PROMETHEUS_CONFIG" "$ALERT_RULES" "$DASHBOARD"; do
  [[ -f "$file" ]] || {
    echo "missing observability artifact: $file" >&2
    exit 1
  }
done

grep -Fq 'app.get("/metrics"' "$METRICS_FILE"
grep -Fq 'upstand_schedules_collection_success' "$METRICS_FILE"
grep -Fq 'upstand_schedules_queue_waiting' "$METRICS_FILE"
grep -Fq 'upstand_schedules_outbox_dead_letter' "$METRICS_FILE"
grep -Fq 'upstand_schedules_backup_age_seconds' "$METRICS_FILE"
grep -Fq 'schedules:3002' "$PROMETHEUS_CONFIG"
grep -Fq 'server:3000' "$PROMETHEUS_CONFIG"
grep -Fq '/_internal/metrics' "$SERVER_ROUTE_FILE"
grep -Fq 'upstand_server_requests_total' "$SERVER_METRICS_FILE"
grep -Fq 'upstand_server_authentication_attempts_total' "$SERVER_METRICS_FILE"
grep -Fq 'UpstandServerAuthenticationFailuresHigh' "$ALERT_RULES"

for metric in \
  upstand_schedules_collection_success \
  upstand_schedules_workers_ready \
  upstand_schedules_database_ready \
  upstand_schedules_redis_ready \
  upstand_schedules_queue_waiting \
  upstand_schedules_queue_failed \
  upstand_schedules_outbox_pending \
  upstand_schedules_outbox_dead_letter \
  upstand_schedules_backup_success_present \
  upstand_schedules_backup_age_seconds \
  upstand_schedules_backup_restore_verified; do
  grep -Fq "$metric" "$ALERT_RULES"
  if [[ "$metric" != upstand_schedules_backup_restore_verified ]]; then
    grep -Fq "$metric" "$DASHBOARD"
  fi
done

echo "observability-contract: passed"
