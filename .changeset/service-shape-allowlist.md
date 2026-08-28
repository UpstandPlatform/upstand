---
"@upstand/api": patch
"@upstand/infrastructure": patch
"@upstand/usecases": patch
---

Fail closed on unknown or future fields in legacy deployment-worker raw
ServiceSpec payloads and Compose documents. Bounded Compose and Swarm service
shapes remain covered by regression tests before Docker inspection or mutation;
unsupported future fields are rejected at the document, service, build, deploy,
and nested resource boundaries. Typed resource-service ContainerSpec fields are
also explicitly reviewed instead of being passed through as an open nested
shape. Malformed nested control shapes now fail closed, and file-backed
config/secret paths reject terminal and mixed-separator parent segments. Compose
API and runtime ingress is also capped at 1 MiB when encoded as UTF-8. In
production, the schedules caller is also denied legacy raw Docker mutation
endpoints and must use the reviewed typed resource capabilities.
