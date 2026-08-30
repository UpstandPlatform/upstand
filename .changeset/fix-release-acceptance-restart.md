---
"server": patch
---

Avoid waiting on hosted Swarm's detached rollout monitor during external-Postgres recovery acceptance; the existing readiness and status probes still verify that database-backed services converge.
