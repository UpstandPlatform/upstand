---
"web": patch
"desktop": patch
---

Resolve desktop runtime SSR session redirect loop and dynamic port routing:
- Allow getServerUrlFromHeaders to resolve dynamically allocated desktop API ports via UPSTAND_SERVER_INTERNAL_URL and NEXT_PUBLIC_SERVER_URL during SSR instead of falling back to default port 3000.
- Prevent infinite redirect ping-pong between SSR /projects and client-side /login in desktop local runtime.
- Update inferApiOrigin to preserve explicit loopback ports when configured.
