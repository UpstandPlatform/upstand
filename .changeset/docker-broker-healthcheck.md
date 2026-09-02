---
"web": patch
---

Fix the production Docker broker healthcheck so TLS health probes succeed without weakening client-certificate enforcement on protected API routes.
