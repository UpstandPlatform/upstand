---
"server": patch
---

Harden runtime-aware authorization across cloud, desktop, and self-hosted control planes. Stored membership permissions are now constrained to their role scope, instance-only operations require interactive owner sessions, cloud-mode policy is resolved consistently, and control-plane transfer requests are bounded. Cloud users can view request observations from their authorized remote servers without exposing control-plane logs, the first workspace is selected reliably after authentication, member role updates use the shared permission catalog, and the web-server settings surface handles configured cloud domains responsively.
