---
"server": patch
---

Reuse an already-present immutable monitoring image during provisioning and pre-pull it in the release acceptance harness, so private GHCR images do not require credentials inside the production container.
