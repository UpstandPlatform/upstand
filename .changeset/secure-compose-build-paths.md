---
"@upstand/usecases": patch
"@upstand/infrastructure": patch
---

Reject Compose build, Dockerfile, env-file, and extension paths that can escape the generated deployment directory, and disable external Compose includes and SSH-agent forwarding during builds.
