---
"server": patch
"web": patch
---

Bundle GeoLite2 country data and a pinned MaxMind lookup binding into the managed OpenResty edge. Country rules and traffic analytics now report the real edge GeoIP capability, and local verification fails when the database is unavailable.
