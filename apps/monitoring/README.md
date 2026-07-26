# @upstand/monitoring (`apps/monitoring`)

The **Upstand Infrastructure Monitoring Agent** is a lightweight system daemon deployed across Docker Swarm compute nodes and remote servers.

## Responsibilities

- **Host & Node Telemetry**: Collects real-time CPU utilization, RAM usage, disk I/O, network throughput, and load averages.
- **Container Health Metrics**: Inspects Docker daemon stats for running resource containers.
- **Metrics Reporter**: Exposes internal health and metrics streams back to the control-plane server (`@upstand/server`) over the encrypted Swarm overlay network (`upstand-network`).

## Commands

```bash
# Run monitoring daemon in dev mode
bun run dev

# Build production executable
bun run build
```
