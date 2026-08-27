---
"@upstand/usecases": patch
---

Reject remote Compose build contexts so deployments cannot make the Docker daemon fetch unreviewed build input outside the bounded local build workspace.
