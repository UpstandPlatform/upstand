---
"@upstand/infrastructure": patch
---

Fail closed on unknown or future fields in legacy deployment-worker raw
ServiceSpec payloads. Bounded Compose and Swarm service shapes remain covered
by regression tests before Docker inspection or mutation.
