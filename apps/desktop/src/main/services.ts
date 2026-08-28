import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { app } from "electron";

type StoredPorts = { api?: number; dashboard?: number };

let apiProcess: ChildProcess | null = null;
let dashboardProcess: ChildProcess | null = null;
let apiOrigin = "";
let dashboardOrigin = "";
let started = false;
const serviceStartupTimeoutMs = 60_000;
const serviceStartupPollIntervalMs = 250;

function portsPath() {
  return join(app.getPath("userData"), "local-services.json");
}

async function readStoredPorts(): Promise<StoredPorts> {
  try {
    const parsed: unknown = JSON.parse(await readFile(portsPath(), "utf8"));
    if (!parsed || typeof parsed !== "object") return {};
    return {
      api:
        "api" in parsed && typeof parsed.api === "number"
          ? parsed.api
          : undefined,
      dashboard:
        "dashboard" in parsed && typeof parsed.dashboard === "number"
          ? parsed.dashboard
          : undefined,
    };
  } catch {
    return {};
  }
}

async function writeStoredPorts(ports: Required<StoredPorts>) {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(portsPath(), JSON.stringify(ports), { mode: 0o600 });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() =>
        port ? resolve(port) : reject(new Error("No free port")),
      );
    });
  });
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

function resourceRoot() {
  return app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), "resources");
}

function resourcePaths() {
  const root = resourceRoot();
  return {
    api: join(
      root,
      "local",
      "server",
      process.platform === "win32"
        ? "upstand-local-server.exe"
        : "upstand-local-server",
    ),
    // Next preserves the workspace path in its standalone output. Keep the
    // containing standalone tree intact so its runtime node_modules remain
    // available, then launch the nested server entrypoint.
    dashboard: join(root, "local", "dashboard", "apps", "web", "server.js"),
    migrations: join(root, "local", "migrations"),
  };
}

async function readOrCreateSecret(name: string): Promise<string> {
  const file = join(app.getPath("userData"), name);
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (existing) return existing;
  } catch {
    // First launch.
  }
  const secret = randomBytes(32).toString("base64url");
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(file, secret, { mode: 0o600 });
  return secret;
}

async function localAuthSecret() {
  return readOrCreateSecret("auth-secret");
}

async function localEncryptionKey() {
  return readOrCreateSecret("encryption-key");
}

async function waitFor(url: string, processRef: ChildProcess): Promise<void> {
  const deadline = Date.now() + serviceStartupTimeoutMs;
  while (Date.now() < deadline) {
    if (processRef.exitCode !== null) {
      throw new Error(`Local service exited before readiness: ${url}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.status > 0) return;
    } catch {
      // The process may still be binding its loopback port.
    }
    await new Promise((resolve) =>
      setTimeout(resolve, serviceStartupPollIntervalMs),
    );
  }
  throw new Error(`Local service did not become ready: ${url}`);
}

function spawnService(
  entry: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
  useElectronNode = true,
) {
  const child = spawn(
    useElectronNode ? process.execPath : entry,
    useElectronNode ? [entry] : [],
    {
      cwd,
      env: useElectronNode
        ? { ...environment, ELECTRON_RUN_AS_NODE: "1" }
        : environment,
      stdio: "pipe",
      windowsHide: true,
    },
  );
  child.stdout?.on("data", (chunk: Buffer) =>
    process.stdout.write(`[desktop:${entry}] ${chunk}`),
  );
  child.stderr?.on("data", (chunk: Buffer) =>
    process.stderr.write(`[desktop:${entry}] ${chunk}`),
  );
  return child;
}

export async function startLocalServices(): Promise<{
  apiOrigin: string;
  dashboardOrigin: string;
}> {
  if (started) return { apiOrigin, dashboardOrigin };
  const paths = resourcePaths();
  if (!app.isPackaged) {
    throw new Error(
      "Bundled local services are only started by packaged Desktop.",
    );
  }

  const stored = await readStoredPorts();
  const apiPort =
    stored.api && (await isPortFree(stored.api))
      ? stored.api
      : await freePort();
  const dashboardPort =
    stored.dashboard &&
    stored.dashboard !== apiPort &&
    (await isPortFree(stored.dashboard))
      ? stored.dashboard
      : await freePort();
  const nextApiOrigin = `http://127.0.0.1:${apiPort}`;
  const nextDashboardOrigin = `http://127.0.0.1:${dashboardPort}`;
  const dataDir = join(app.getPath("userData"), "data");
  const baseEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    UPSTAND_PLATFORM: "desktop",
    PGLITE_DATA_DIR: dataDir,
    PGLITE_ASSETS_DIR: join(resourceRoot(), "local", "pglite"),
    SWAGGER_UI_ASSETS_DIR: join(resourceRoot(), "local", "swagger"),
    UPSTAND_NODE_RUNTIME_PATH: process.execPath,
    DB_MIGRATIONS_PATH: paths.migrations,
    BETTER_AUTH_SECRET: await localAuthSecret(),
    ENCRYPTION_KEY_V1: await localEncryptionKey(),
    HOST: "127.0.0.1",
    PORT: String(apiPort),
    REDIS_URL: "",
  };

  apiProcess = spawnService(
    paths.api,
    join(paths.api, ".."),
    {
      ...baseEnvironment,
      UPSTAND_BASE_URL: nextApiOrigin,
      BETTER_AUTH_URL: nextApiOrigin,
      CORS_ORIGIN: nextDashboardOrigin,
    },
    false,
  );
  dashboardProcess = spawnService(
    paths.dashboard,
    join(paths.dashboard, ".."),
    {
      ...baseEnvironment,
      PORT: String(dashboardPort),
      HOSTNAME: "127.0.0.1",
      NEXT_PUBLIC_SERVER_URL: nextApiOrigin,
      UPSTAND_SERVER_INTERNAL_URL: nextApiOrigin,
    },
  );

  try {
    await Promise.all([
      waitFor(`${nextApiOrigin}/health/live`, apiProcess),
      waitFor(nextDashboardOrigin, dashboardProcess),
    ]);
  } catch (error) {
    stopLocalServices();
    throw error;
  }

  apiOrigin = nextApiOrigin;
  dashboardOrigin = nextDashboardOrigin;
  started = true;
  await writeStoredPorts({ api: apiPort, dashboard: dashboardPort });
  return { apiOrigin, dashboardOrigin };
}

export function getLocalApiOrigin() {
  return apiOrigin;
}

export function getLocalDashboardOrigin() {
  return dashboardOrigin;
}

export function stopLocalServices() {
  apiProcess?.kill("SIGTERM");
  dashboardProcess?.kill("SIGTERM");
  apiProcess = null;
  dashboardProcess = null;
  apiOrigin = "";
  dashboardOrigin = "";
  started = false;
}
