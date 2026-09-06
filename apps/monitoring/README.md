# @upstand/monitoring (`apps/monitoring`)

The **Upstand Infrastructure Monitoring Agent** is a lightweight system daemon deployed across Docker Swarm compute nodes and remote servers.

## Responsibilities

- **Host & Node Telemetry**: Collects real-time CPU utilization, RAM usage, disk I/O, network throughput, and load averages.
- **Container Health Metrics**: The local agent uses `containers.source: "control-plane"` to fetch signed snapshots from the control plane's fixed `/api/monitoring/local-containers` endpoint. The control plane reads Docker through its existing broker identity; the agent receives neither broker credentials nor a Docker socket. Remote agents with an explicitly provisioned Docker transport retain the default `docker` source.
- **Metrics Reporter**: Exposes internal health and metrics streams back to the control plane. The local agent uses the encrypted, internal Docker control network.
- **Collection Health**: `/health` returns 503 if host or container collection fails or becomes stale. The control plane probes current agent health for readiness, rather than remembering successful startup alone. Every running replica is persisted separately.

Local snapshots are coalesced, cached for five seconds, and collected with at most
16 concurrent Docker reads. Hosts with more than 256 running containers fail the
snapshot explicitly rather than silently dropping metrics. Agent requests time
out after 30 seconds, reject redirects, and cap responses at 1 MiB. HMAC signatures
bind the method, fixed path and timestamp; only the local agent's key is accepted,
with a 60-second clock-skew window. Remote-agent keys and user sessions cannot
authorize these host-wide snapshots.

## Commands

```bash
# Run the Go agent with METRICS_CONFIG and DB_PATH configured
go run .

# Test collection, persistence, and health (requires a C compiler for SQLite)
go test -race ./...

# Build the Go executable
go build .
```
