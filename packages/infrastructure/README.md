# @upstand/infrastructure (`packages/infrastructure`)

The `@upstand/infrastructure` package implements infrastructure adapters, Docker daemon integration, SSH transports, Caddy compiler, and external storage clients for Upstand.

## Modules

- `src/docker/`: Docker Swarm engine integration via `dockerode`. Helper functions for overlay network management (`ensureUpstandOverlayNetwork`, `ensureResourceOverlayNetwork`), service lifecycle, container log streaming, and volume pruning.
- `src/caddy/`: Dynamic Caddyfile compiler, snippet importer, dry-run syntax validation, and atomic reload API integration.
- `src/ssh/`: Ephemeral SSH transport engine for remote server provisioning, node draining, and Docker Swarm cluster join operations.
- `src/s3/`: S3 client wrapper for streaming database dumps, multipart AES-256 GCM uploads, and archive verification.
- `src/rate-limit/`: Dual-tier rate limiter (`RateLimiter`) with Redis backend and in-memory fallback.

## Usage

```typescript
import { RateLimiter } from "@upstand/infrastructure/rate-limit";
import { ensureResourceOverlayNetwork } from "@upstand/usecases/swarm/swarm.helpers";
```
