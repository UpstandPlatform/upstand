#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
METRICS_FILE="$ROOT_DIR/apps/schedules/src/health.ts"
PROMETHEUS_CONFIG="$ROOT_DIR/ops/observability/prometheus.yml"
ALERT_RULES="$ROOT_DIR/ops/observability/upstand-alerts.yml"
DASHBOARD="$ROOT_DIR/ops/observability/upstand-schedules-dashboard.json"

for file in "$METRICS_FILE" "$PROMETHEUS_CONFIG" "$ALERT_RULES" "$DASHBOARD"; do
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
  upstand_schedules_backup_age_seconds; do
  grep -Fq "$metric" "$ALERT_RULES"
  grep -Fq "$metric" "$DASHBOARD"
done

echo "observability-contract: passed"
