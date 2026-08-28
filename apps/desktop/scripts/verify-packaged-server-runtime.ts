import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "..");
const maxOutputLength = 16_000;
const dockerProxyPort = 23775;
const startupTimeoutMs = 60_000;
const startupPollIntervalMs = 250;

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() =>
        port ? resolvePort(port) : reject(new Error("No free port available")),
      );
    });
  });
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolveListening) => {
    let settled = false;
    const settle = (listening: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolveListening(listening);
    };
    const timeout = setTimeout(() => {
      settle(false);
    }, 500);
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}

async function waitForPortToClose(port: number): Promise<void> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (!(await isPortListening(port))) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Detached Docker proxy still owns 127.0.0.1:${port}`);
}

async function waitForHealth(
  url: string,
  processRef: ReturnType<typeof spawn>,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (processRef.exitCode !== null) {
      throw new Error(
        `Packaged local service exited before it became healthy: ${url}\n${output()}`,
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
    } catch {
      // The local control plane may still be opening its loopback listener.
    }
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, startupPollIntervalMs),
    );
  }
  throw new Error(
    `Packaged local control plane did not become healthy: ${url}\n${output()}`,
  );
}

if (process.platform !== "win32") {
  throw new Error(
    "The packaged server verification must run on Windows, where the release artifact is produced.",
  );
}

const executable = resolve(appRoot, "out", "upstand-win32-x64", "upstand.exe");
const apiEntry = resolve(
  appRoot,
  "out",
  "upstand-win32-x64",
  "resources",
  "local",
  "server",
  "upstand-local-server.exe",
);
const migrations = resolve(
  appRoot,
  "out",
  "upstand-win32-x64",
  "resources",
  "local",
  "migrations",
);
const dashboardEntry = resolve(
  appRoot,
  "out",
  "upstand-win32-x64",
  "resources",
  "local",
  "dashboard",
  "apps",
  "web",
  "server.js",
);
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "upstand-desktop-runtime-"),
);
const apiPort = await freePort();
const dashboardPort = await freePort();
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const dashboardOrigin = `http://127.0.0.1:${dashboardPort}`;
const proxyWasAlreadyListening = await isPortListening(dockerProxyPort);
let output = "";

function startService(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
) {
  const child = spawn(command, args, {
    cwd: resolve(command, ".."),
    env: environment,
    stdio: "pipe",
    windowsHide: true,
  });
  const appendOutput = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-maxOutputLength);
  };
  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);
  return child;
}

const baseEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: "1",
  NODE_ENV: "production",
  UPSTAND_PLATFORM: "desktop",
  PGLITE_DATA_DIR: join(temporaryDirectory, "data"),
  PGLITE_ASSETS_DIR: resolve(
    appRoot,
    "out",
    "upstand-win32-x64",
    "resources",
    "local",
    "pglite",
  ),
  SWAGGER_UI_ASSETS_DIR: resolve(
    appRoot,
    "out",
    "upstand-win32-x64",
    "resources",
    "local",
    "swagger",
  ),
  UPSTAND_NODE_RUNTIME_PATH: executable,
  DB_MIGRATIONS_PATH: migrations,
  // Disposable values for this isolated runtime check. They are never logged.
  BETTER_AUTH_SECRET: "desktop-runtime-test-secret-at-least-32-characters",
  UPGAL_TOOL_APPROVAL_SECRET:
    "desktop-runtime-test-approval-secret-at-least-32-characters",
  ENCRYPTION_KEY_V1: "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=",
  HOST: "127.0.0.1",
  REDIS_URL: "",
};

const apiProcess = startService(apiEntry, [], {
  ...baseEnvironment,
  ELECTRON_RUN_AS_NODE: undefined,
  PORT: String(apiPort),
  UPSTAND_BASE_URL: apiOrigin,
  BETTER_AUTH_URL: apiOrigin,
  CORS_ORIGIN: dashboardOrigin,
});
const dashboardProcess = startService(executable, [dashboardEntry], {
  ...baseEnvironment,
  PORT: String(dashboardPort),
  HOSTNAME: "127.0.0.1",
  NEXT_PUBLIC_SERVER_URL: apiOrigin,
  UPSTAND_SERVER_INTERNAL_URL: apiOrigin,
});

try {
  await Promise.all([
    waitForHealth(`${apiOrigin}/health/live`, apiProcess, () => output),
    waitForHealth(dashboardOrigin, dashboardProcess, () => output),
  ]);
  process.stdout.write(
    "Packaged local control plane and dashboard passed their health checks.\n",
  );
} finally {
  const services = [apiProcess, dashboardProcess];
  const exits = services.map((processRef) =>
    processRef.exitCode === null
      ? new Promise<void>((resolveExit) => {
          processRef.once("exit", () => resolveExit());
          setTimeout(resolveExit, 5_000).unref();
        })
      : Promise.resolve(),
  );
  for (const processRef of services) processRef.kill();
  await Promise.all(exits);
  if (!proxyWasAlreadyListening) await waitForPortToClose(dockerProxyPort);
  await rm(temporaryDirectory, { force: true, recursive: true });
}
