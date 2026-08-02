# Upstand observability bundle

This directory contains the Prometheus scrape configuration, alert rules, and
Grafana dashboard for the private schedules metrics endpoint.

The endpoint is `http://schedules:3002/metrics` inside the production overlay.
Do not publish it through the customer-facing proxy: it is a monitoring
surface, not an operator authentication boundary. The deployment must also
retain the existing Evlog/OTLP pipeline for structured application logs and
`operationalAlert` events.

The default thresholds mirror the production environment defaults. If an
installation changes `UPSTAND_*_ALERT_*` values, update the Prometheus rule
thresholds in the same change and record the owner, notification route,
retention period, and SLO policy in the target incident system.

Before enabling paging, validate the following in the target environment:

1. Prometheus can scrape `/metrics` from the schedules task.
2. The `upstand_schedules_collection_success` and readiness alerts fire during
   a controlled dependency outage and recover afterwards.
3. Backup and queue alerts reach the assigned on-call route.
4. Dashboard and alert data meet the installation's retention policy.
