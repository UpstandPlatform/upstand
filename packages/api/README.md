# @upstand/api (`packages/api`)

The `@upstand/api` package contains tRPC router definitions, MCP JSON-RPC protocol implementation, UpGal tool definitions, and API authentication middleware for the Upstand platform.

## Contents

- `src/trpc/`: Central tRPC router, procedures, context builders, and permission guards.
- `src/ai/upgal.ts`: UpGal AI assistant tool loop engine (`ToolLoopAgent`), tool definitions (`list_projects`, `deploy_resource`, `get_audit_logs`), and dashboard human-in-the-loop approval token handlers.
- `src/ai/upgal-errors.ts`: Error classification and formatting helper (`classifyUpGalError`) for tool validation errors.
- `src/middleware/api-key-auth.ts`: Organization API Key authentication (`upk_...`) and permission capability checks (`API_KEY_ROUTE_CAPABILITIES`).
- `src/middleware/rate-limit.ts`: API route rate limiting using Redis and in-memory fallback counters.

## Usage

```typescript
import { trpcRouter } from "@upstand/api";
import { classifyUpGalError } from "@upstand/api/ai/upgal-errors";
import { authenticateApiKey } from "@upstand/api/middleware/api-key-auth";
```
