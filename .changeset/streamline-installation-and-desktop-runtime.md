---
"server": patch
"schedules": patch
"web": patch
"fumadocs": patch
"desktop": patch
---

Streamline installation topology, Proxmox LXC/container support, and standalone desktop runtime:
- Fix Desktop local control plane startup by provisioning `UPGAL_TOOL_APPROVAL_SECRET`, capturing diagnostic process logs, and bypassing daemon-dependent background reconciliation when running in desktop mode.
- Streamline `install.sh` defaults for single-replica, telemetry acknowledgements, and host resource sizing, allowing seamless deployment on single VPS instances and containers without manual overrides.
- Add automatic container detection for Proxmox LXC and Incus with unencrypted Swarm overlay network fallback when IPsec/ESP kernel encryption is unavailable.
- Default to accessible direct IP bootstrap origins (`http://<ip>:3000` / `http://<ip>:3001`) when custom domains/HTTPS are omitted, with non-fatal host connectivity warnings.
- Broaden Linux distribution support in remote server setup using official Docker install scripts and unencrypted overlay fallback.
