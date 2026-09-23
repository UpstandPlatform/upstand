---
"server": patch
---

Fix control-plane defects found while exercising the desktop, self-hosted, cloud, and database-server modes against a running instance.

- Restore every mutation in the desktop runtime. Sensitive and expensive routes fail closed when the distributed rate limiter is unavailable, which is correct for a multi-replica deployment losing Redis, but desktop ships no Redis by design and so rejected every create, update, and delete with "Rate limiter temporarily unavailable". The limiter now treats a single-process control plane as authoritative rather than degraded, and reports its status as `single-process`.
- Fix global search, which failed with "undefined is not an object" on every query in every mode. The use case held a detached reference to the repository's search method, so the Drizzle implementation lost its receiver. The regression test now uses a class-based double that depends on `this`.
- Reject a workload migration whose target server role cannot host the resource, so an application can no longer be migrated onto a database or build server. The migration preflight repeats the check so a migration queued before a server changed role also fails closed.
- Start a deployment queue consumer for database servers. Database resources are legitimately placed on database hosts, but their queue had no worker, so those deployments stayed queued forever. Build servers remain excluded because they only compile images for another target's deployment job.
- Process backup, notification-delivery, and workload-migration outbox commands in the desktop runtime. Desktop has no Redis and therefore no BullMQ workers, so these commands were claimed by nothing and never ran.
- Make deployment cancellation work in the desktop runtime through an in-process cancellation marker, and report in-flight desktop deployments in the queue view instead of showing an empty queue.
- Keep server-inventory reads responsive: the topology graph no longer probes Docker on servers that have not completed setup, and deployment server settings survive an unreachable local Docker daemon instead of failing the whole query.
