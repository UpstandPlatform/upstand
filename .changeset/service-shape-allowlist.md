---
"@upstand/infrastructure": patch
---

Fail closed on unknown or future fields in legacy deployment-worker raw
ServiceSpec payloads and Compose documents. Bounded Compose and Swarm service
shapes remain covered by regression tests before Docker inspection or mutation;
unsupported future fields are rejected at the document, service, build, deploy,
and nested resource boundaries. Compose API and runtime ingress is also capped
at 1 MiB when encoded as UTF-8.
