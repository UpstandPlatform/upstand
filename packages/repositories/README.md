# @upstand/repositories (`packages/repositories`)

The `@upstand/repositories` package provides data access repositories following the Repository Pattern to abstract Drizzle ORM operations for domain usecases.

## Repositories Included

- `OrganizationRepository`: Manages organization scopes, memberships, custom roles, and SCIM directory mappings.
- `ProjectRepository`: Manages projects, environments, and environment variable inheritance hierarchies.
- `ResourceRepository`: Manages applications, Docker Compose resources, and database workloads.
- `ServerRepository`: Manages Docker Swarm managers, worker nodes, and SSH remote servers.
- `DeploymentRepository`: Manages build/deployment histories, rollback registries, and commit SHA tracking.
- `AuditLogRepository`: Manages searchable organization audit event logs.

## Usage

```typescript
import { OrganizationRepository } from "@upstand/repositories";
```
