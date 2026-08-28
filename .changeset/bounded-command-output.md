---
"@upstand/infrastructure": patch
---

Terminate deployment commands that exceed the bounded streamed log-output limit, preventing untrusted build or deployment output from exhausting worker and broker logging resources.
