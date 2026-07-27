---
"server": patch

---

Add private-registry authentication support to the self-hosted installer. Registry
credentials are forwarded to Docker Swarm for image pulls and removed from the
installer host's Docker credential store after deployment.
