---
"server": patch
---

Reconnect Redis sockets that remain incorrectly ready after a failed or timed-out health probe, allowing readiness to recover without restarting the application.
