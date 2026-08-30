---
"server": patch
---

Retry Caddy and monitoring initialization during startup so a newly deployed
Swarm can converge when the Docker broker is still starting.
