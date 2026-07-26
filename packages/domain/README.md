# @upstand/domain (`packages/domain`)

The `@upstand/domain` package contains pure domain models, entities, value objects, domain error classes, and permission capability constants for the Upstand platform.

## Contents

- `src/models/`: Domain entity definitions (`Resource`, `Server`, `Deployment`, `Backup`, `Organization`, `User`).
- `src/constants/`: System constants and API key capability route maps (`API_KEY_ROUTE_CAPABILITIES`).
- `src/errors/`: Standard domain errors (`UpGalError`, `ValidationError`, `NotFoundError`, `UnauthorizedError`, `ConflictError`).
- `src/events/`: Domain event contracts for deployment, backup, and server state transitions.

## Usage

```typescript
import { API_KEY_ROUTE_CAPABILITIES } from "@upstand/domain/constants";
import { UpGalError, ValidationError } from "@upstand/domain/errors";
```
