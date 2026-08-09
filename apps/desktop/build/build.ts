import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(appRoot, "..", "..");
const output = resolve(appRoot, "dist");

async function safeCopyFile(
  source: string,
  destination: string,
  retries = 5,
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await copyFile(source, destination);
      return;
    } catch (error) {
      if (
        i === retries - 1 ||
        !(error instanceof Error) ||
        !("code" in error) ||
        (error.code !== "EBUSY" &&
          error.code !== "EPERM" &&
          error.code !== "EACCES")
      ) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error.code === "EBUSY" ||
            error.code === "EPERM" ||
            error.code === "EACCES")
        ) {
          return;
        }
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (i + 1)));
    }
  }
}

async function copyTree(source: string, destination: string): Promise<void> {
  try {
    const linkTarget = await readlink(source);
    try {
      await copyTree(resolve(dirname(source), linkTarget), destination);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
    return;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code !== "EINVAL") {
      throw error;
    }
  }

  try {
    const entries = await readdir(source, { withFileTypes: true });
    await mkdir(destination, { recursive: true });
    for (const entry of entries) {
      await copyTree(join(source, entry.name), join(destination, entry.name));
    }
    return;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOTDIR"
    ) {
      throw error;
    }
    await mkdir(resolve(destination, ".."), { recursive: true });
    await safeCopyFile(source, destination);
    return;
  }
}

async function copyGeneratedTree(
  source: string,
  destination: string,
): Promise<void> {
  const copyResolved = async (
    currentSource: string,
    currentDestination: string,
    ancestors: Set<string>,
  ): Promise<void> => {
    const absoluteSource = resolve(currentSource);
    const cycleKey = absoluteSource.toLocaleLowerCase();
    if (ancestors.has(cycleKey)) {
      throw new Error(
        `Symlink cycle detected while staging '${currentSource}'`,
      );
    }
    const info = await lstat(absoluteSource);
    if (info.isSymbolicLink()) {
      const target = await readlink(absoluteSource);
      const targetSource = resolve(dirname(absoluteSource), target);
      const targetKey = targetSource.toLocaleLowerCase();
      if (ancestors.has(targetKey)) {
        // Package managers may legitimately form a cyclic dependency graph.
        // Node will resolve this dependency from an ancestor node_modules
        // directory, so do not recurse forever while staging it.
        return;
      }
      const nextAncestors = new Set(ancestors).add(cycleKey);
      try {
        await copyResolved(targetSource, currentDestination, nextAncestors);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          throw error;
        }
      }
      return;
    }
    if (info.isDirectory()) {
      await mkdir(currentDestination, { recursive: true });
      for (const entry of await readdir(absoluteSource)) {
        if (entry === "node_modules" && ancestors.size > 0) {
          continue;
        }
        await copyResolved(
          join(absoluteSource, entry),
          join(currentDestination, entry),
          ancestors,
        );
      }
      return;
    }
    await mkdir(dirname(currentDestination), { recursive: true });
    await safeCopyFile(absoluteSource, currentDestination);
  };

  await copyResolved(source, destination, new Set());
}

try {
  await rm(output, { force: true, recursive: true });
} catch {
  // Ignore removal error on Windows
}
await mkdir(output, { recursive: true });

for (const [entrypoint, outfile] of [
  ["src/main/index.ts", "dist/main.cjs"],
  ["src/preload/index.ts", "dist/preload.cjs"],
] as const) {
  const temporaryOutput = resolve(
    output,
    ".bundle",
    entrypoint.replaceAll("/", "-"),
  );
  await mkdir(temporaryOutput, { recursive: true });
  const result = await Bun.build({
    entrypoints: [resolve(appRoot, entrypoint)],
    external: ["electron"],
    format: "cjs",
    minify: false,
    outdir: temporaryOutput,
    target: "node",
  });
  if (!result.success) {
    throw new Error(
      result.logs.map((log: { message: string }) => log.message).join("\n"),
    );
  }
  const generated = result.outputs[0];
  if (!generated) throw new Error(`No bundle was produced for ${entrypoint}`);
  await rename(generated.path, resolve(appRoot, outfile));
}
try {
  await rm(resolve(output, ".bundle"), { force: true, recursive: true });
} catch {
  // Ignore removal error on Windows
}

await copyTree(resolve(appRoot, "src/renderer"), resolve(output, "renderer"));

const isPackageBuild =
  process.argv.includes("--package") || process.env.NODE_ENV === "production";

if (isPackageBuild) {
  // Packaged Desktop owns a local control plane. The payloads are produced by
  // the normal server/web builds and staged beside the Electron bundle so the
  // supervisor can launch them with loopback-only, per-install configuration.
  const localRoot = resolve(output, "resources", "local");
  await mkdir(localRoot, { recursive: true });
  const dashboardStandalone = resolve(
    workspaceRoot,
    "apps",
    "web",
    ".next",
    "standalone",
  );
  const dashboardNodeModules = resolve(
    dashboardStandalone,
    "node_modules",
    ".bun",
    "node_modules",
  );
  const migrations = resolve(
    workspaceRoot,
    "packages",
    "db",
    "src",
    "migrations",
  );
  for (const [source, destination] of [
    [dashboardStandalone, resolve(localRoot, "dashboard")],
    [migrations, resolve(localRoot, "migrations")],
  ] as const) {
    try {
      await copyGeneratedTree(source, destination);
    } catch (error) {
      throw new Error(
        `Missing generated Desktop payload '${source}'. Run the server and web production builds first. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const localServerDirectory = resolve(localRoot, "server");
  await mkdir(localServerDirectory, { recursive: true });
  const localServerBinary = resolve(
    localServerDirectory,
    process.platform === "win32"
      ? "upstand-local-server.exe"
      : "upstand-local-server",
  );
  const serverCompile = Bun.spawn({
    cmd: [
      process.execPath,
      "build",
      resolve(workspaceRoot, "apps", "server", "src", "index.ts"),
      "--compile",
      "--packages=bundle",
      "--outfile",
      localServerBinary,
    ],
    cwd: workspaceRoot,
    stderr: "inherit",
    stdout: "inherit",
  });
  if ((await serverCompile.exited) !== 0) {
    throw new Error("Failed to compile the Desktop local server executable");
  }

  // Next's traced standalone output uses Bun's internal link store. Electron's
  // Node resolver does not traverse that link map, so materialize its traced
  // entries at the dashboard root. The nested entrypoint already has Next.
  const stagedDashboardModules = resolve(
    localRoot,
    "dashboard",
    "node_modules",
  );
  for (const entry of await readdir(dashboardNodeModules)) {
    if (entry === "next" || entry === ".bin") continue;
    await copyGeneratedTree(
      resolve(dashboardNodeModules, entry),
      resolve(stagedDashboardModules, entry),
    );
  }

  const pgliteAssetsDirectory = resolve(localRoot, "pglite");
  await mkdir(pgliteAssetsDirectory, { recursive: true });
  const pglitePackageDirectory = resolve(
    dirname(
      Bun.resolveSync(
        "@electric-sql/pglite",
        resolve(workspaceRoot, "packages", "db", "src", "index.ts"),
      ),
    ),
    "..",
  );
  for (const asset of ["pglite.data", "pglite.wasm"]) {
    await safeCopyFile(
      resolve(pglitePackageDirectory, "dist", asset),
      resolve(pgliteAssetsDirectory, asset),
    );
  }

  const swaggerPackageDirectory = dirname(
    Bun.resolveSync(
      "swagger-ui-dist",
      resolve(workspaceRoot, "apps", "server", "src", "openapi.ts"),
    ),
  );
  const swaggerAssetsDirectory = resolve(localRoot, "swagger");
  await mkdir(swaggerAssetsDirectory, { recursive: true });
  for (const asset of [
    "swagger-ui.css",
    "swagger-ui-bundle.js",
    "swagger-ui-standalone-preset.js",
  ]) {
    await safeCopyFile(
      resolve(swaggerPackageDirectory, asset),
      resolve(swaggerAssetsDirectory, asset),
    );
  }
}
