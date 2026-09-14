---
"server": patch
"web": patch
"schedules": patch
"fumadocs": patch
---

Keep the control plane reachable through direct IP ports as a permanent
break-glass path, and add Dokploy-compatible deployment-time external secret
provider references. Harden the installer and document supported VM, Incus,
nested Docker, interactive, upgrade, and recovery flows.
