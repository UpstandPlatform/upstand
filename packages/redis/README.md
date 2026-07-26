# @upstand/redis (`packages/redis`)

The `@upstand/redis` package manages Redis client connections, pub/sub event emitters, rate-limiting counters, and BullMQ queue connections for Upstand.

## Features

- **Centralized Client**: Exports singleton `redis` client instance and connection factory `createRedisClient`.
- **BullMQ Integration**: Manages BullMQ job queues for deployment workers (`deployments-queue-<nodeId>`), backup workers, cron workers, and notification workers.
- **Distributed Locking**: Provides Redis-backed resource lock primitives to serialize concurrent deployment builds per workload.

## Usage

```typescript
import { redis, createRedisClient } from "@upstand/redis";
```
