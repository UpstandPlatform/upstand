---
"server": patch
"schedules": patch
"web": patch
"fumadocs": patch
"desktop": patch
---

Fix step-up 2FA verification loops and standalone desktop runtime:
- Restore step-up authentication compatibility for non-2FA accounts across procedures and services.
- Only query session 2FA verification and trigger 2FA redirects when the user has two-factor authentication enabled, eliminating recursive toast errors and infinite dashboard redirects.
- Provide self-contained in-memory fallback storage for Better Auth secondary storage and step-up auth when running in standalone desktop runtime without Redis.
