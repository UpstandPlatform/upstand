---
"server": patch
---

Restore local container telemetry through an authenticated, read-only control-plane snapshot without exposing Docker credentials to the agent. Fail readiness on failed or stale collection, retain every container replica, and keep telemetry collection bounded.
