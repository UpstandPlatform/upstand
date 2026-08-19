---
"web": patch
"server": patch
"schedules": patch
"fumadocs": patch
---

Harden direct-IP runtime origin detection so domain deployments using non-standard ports keep their configured cloud API, while direct dashboard URLs continue to resolve to the local API port. Improve the login recovery state with clearer outage guidance, retry feedback, and accessible status messaging.
