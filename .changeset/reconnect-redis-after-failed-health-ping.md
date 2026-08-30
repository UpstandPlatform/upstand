---
"@upstand/redis": patch
---

Reset stale Redis connections after a failed health ping so readiness can recover after a dependency outage.
