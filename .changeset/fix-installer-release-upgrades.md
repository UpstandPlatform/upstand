---
"server": patch
---

Fix installer reruns and upgrades to retain bundled PostgreSQL and Redis, preserve the monitoring token, and resolve images for the requested release instead of reusing the previous release's saved pins. Explicit image overrides remain supported, and mixed bundled/external data endpoints are rejected before deployment.
