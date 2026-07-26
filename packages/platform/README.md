# @upstand/platform (`packages/platform`)

The `@upstand/platform` package handles platform orchestration, system updates, container cleanup routines, and horizontal service scaling for Upstand.

## Modules

- `src/updates/`: System update engine, GitHub release channel check, and database schema migration runner.
- `src/scaling/`: Metrics-driven horizontal pod/service autoscaler for Docker Swarm replicas.
- `src/cleanup/`: Automated Docker system prune, unattached volume removal, and expired build cache purging routines.
