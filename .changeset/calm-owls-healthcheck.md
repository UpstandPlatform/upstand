---
"server": patch
---

Use the server liveness endpoint for the container healthcheck so Swarm startup cannot deadlock while schedules waits for the server to bind.
