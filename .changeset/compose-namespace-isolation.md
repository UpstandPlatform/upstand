---
"@upstand/infrastructure": patch
"@upstand/usecases": patch
---

Reject Compose namespace sharing, inherited container volumes, and external container links that could cross workload isolation boundaries, and preserve resource ownership labels on Swarm service metadata.
