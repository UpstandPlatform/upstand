---
"@upstand/infrastructure": patch
---

Revalidate deployment-worker service volume ownership and service isolation controls immediately before raw service mutations, including host-side logging, secondary network attachments, device reservations, host aliases, and unbounded resource controls. Verify Railpack release archives and cached executables against checked-in SHA-256 digests before running them.
Also constrain typed and legacy service endpoint specifications to bounded
ingress ports and supported endpoint modes before Docker forwarding.
The legacy deployment-worker build query is now an explicit allowlist with bounded target, boolean, and API-version validation so newly added Docker fields fail closed until reviewed.
The raw deployment-worker service mutation path now applies an explicit nested
allowlist to ServiceSpec, TaskTemplate, ContainerSpec, resource, restart,
placement, update, rollback, mode, and network-attachment fields. Unknown or
future fields fail closed before Docker inspection, while bounded Compose and
Swarm service shapes remain covered by regression tests.
