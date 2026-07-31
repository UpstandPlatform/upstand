# Deploy fixtures

Minimal, real "hello world on `$PORT`" apps — one per stack family — used to
validate that stack **detection produces the correct recipe** (toolchain,
package manager, install/build/start commands, output/production paths, port).

Each app:

- binds the port from the `PORT` environment variable (the runtime injects it),
- responds `200` on `/`,
- is intentionally tiny — just enough to exercise detection and, later, a real
  build+deploy+probe smoke test across the docker / bare / cloud runtimes.

The recipe assertions live in `apps/api/test/lib/language-detectors.test.ts`.

Wrappers (`mvnw` / `gradlew`) are intentionally **omitted** here so the fixtures
stay source-only; the wrapper-preference path is covered by inline cases in the
test instead.
