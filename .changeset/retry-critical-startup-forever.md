---
"@upstand/server": patch
---

Keep critical Caddy and monitoring startup initialization retrying until dependencies recover so transient deployment races cannot leave production readiness permanently blocked.
