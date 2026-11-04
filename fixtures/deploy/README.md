# Deploy fixtures

Minimal, first-party "hello world on `$PORT`" apps — one per stack family —
used to validate Upstand build detection and deployment behavior. The Node
fixture also carries an `upstand.json` example so repository-declared build,
runtime, and cron configuration stays covered by the deployment pipeline.

Each app:

- binds the port from the `PORT` environment variable (the runtime injects it),
- responds `200` on `/`,
- is intentionally tiny so deterministic pipeline tests can exercise the
  production orchestration while mocking only external Docker, SSH, Git, and
  registry boundaries.

Fixture checks live beside the Docker deployment adapter and in the server's
deployment pipeline tests.

Wrappers (`mvnw` / `gradlew`) are intentionally **omitted** here so the fixtures
stay source-only; the wrapper-preference path is covered by inline cases in the
test instead.
