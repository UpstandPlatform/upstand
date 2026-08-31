---
"server": patch
"schedules": patch
"web": patch
"fumadocs": patch
---

Fix passkey route availability in production-shaped releases and make self-updates validate the complete control-plane service set before applying immutable images. Failed multi-service updates now roll back instead of leaving a mixed-version installation.
