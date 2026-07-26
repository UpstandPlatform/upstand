---
"server": patch
"web": patch
---

Harden Compose workloads by rejecting host namespace access, privileged mode,
host devices, Docker socket mounts, and host bind volumes. Advanced resource
storage configuration now accepts named Docker volumes only, and managed
services default to no-new-privileges with all capabilities dropped.

Use atomic Redis-backed authentication rate-limit counters so concurrent
requests cannot bypass the configured limits.
