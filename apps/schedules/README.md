# Upstand Schedules Service (`apps/schedules`)

The **Upstand Schedules Service** is a dedicated, lightweight, standalone microservice within the Upstand platform monorepo. It manages all scheduled tasks (cron jobs), background workers, and queue processing.

## Architecture

- **Schedulers**:
  - `BackupScheduler`: Evaluates database and web server backup schedules.
  - `GeneralScheduler`: Processes user-configured custom cron jobs.
  - `AccessLogCleanupScheduler`: Cleans up access logs based on system policy.
  - `ScheduledDockerCleanup`: Performs daily Docker system resource pruning.
  - `AutoscalingRuntime`: Reconciles resource replica scaling based on performance metrics.
  - `SecretRotationScheduler`: Reconciles due secret rotations.

- **Workers (BullMQ)**:
  - `BackupRunWorker`: Consumes database and application backup execution tasks.
  - `NotificationDeliveryWorker`: Delivers system notifications via configured channels.
  - `DeploymentWorker`: Process deployment queue builds per server.

- **Health & Monitoring HTTP API**:
  - `GET /health/live`: Liveness check.
  - `GET /health/ready`: Readiness check (verifies worker readiness).
  - `GET /status`: Detailed metrics and BullMQ queue status.
  - `GET /metrics`: Private Prometheus-compatible gauges for readiness, queue,
    outbox, and backup monitoring. Keep this endpoint on the internal overlay;
    it is not an operator authentication boundary.

## Configuration

| Environment Variable | Description | Default |
| -------------------- | ----------- | ------- |
| `SCHEDULES_PORT` / `PORT` | HTTP health server port | `3002` |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `REDIS_URL` | Redis connection string | — |
