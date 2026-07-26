# @upstand/db (`packages/db`)

The `@upstand/db` package manages PostgreSQL database persistence using **Drizzle ORM**.

## Contents

- `src/schema.ts`: Database table definitions for Organizations, Projects, Environments, Resources, Servers, Deployments, Backups, Audit Logs, API Keys, SSO, and SCIM records.
- `src/migrations/`: Drizzle ORM migration SQL files and snapshot journal.
- `src/index.ts`: Database client export (`db`), connection pool lifecycle, and `closeDb()` graceful shutdown.
- `src/migrate.ts`: Programmatic migration runner (`runDatabaseMigrations`).

## Commands & Usage

```typescript
import { db, schema, closeDb, runDatabaseMigrations } from "@upstand/db";
```

```bash
# Generate new Drizzle migration files from schema changes
bun run generate

# Apply pending database migrations
bun run migrate
```
