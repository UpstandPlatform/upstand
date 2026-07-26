# @upstand/env (`packages/env`)

The `@upstand/env` package provides type-safe environment variable validation powered by **Zod**.

## Features

- **Server Validation (`server.ts`)**: Validates server configuration (`DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `DOCKER_NETWORK`, `ENCRYPTION_KEY_V1`, etc.).
- **Client Validation (`web.ts`)**: Validates public Next.js environment variables (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`).
- **Build-Time Skipping**: Supports `SKIP_ENV_VALIDATION=1` to allow container builds or standalone tools to build without requiring live database connections.

## Usage

```typescript
import { env } from "@upstand/env/server";
import { webEnv } from "@upstand/env/web";
```
