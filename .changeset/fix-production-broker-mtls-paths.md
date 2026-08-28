---
"server": patch
"schedules": patch
---

Fix production Swarm broker mTLS paths so the server, scheduler, and deployment worker read the secret filenames mounted by Docker.
