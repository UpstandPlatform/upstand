---
"web": patch
"server": patch
"schedules": patch
"fumadocs": patch
---

Fix remote server verification so Docker connectivity cannot be reported as a successful Upstand installation when provisioning has failed. The verification dialog now reports setup failures, validates host clock drift, and only marks a server operational after provisioning and runtime checks pass.
