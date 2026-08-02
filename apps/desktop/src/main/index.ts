import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  shell,
} from "electron";
import {
  type DesktopConnection,
  isAllowedNavigation,
  normalizeUpstandOrigin,
} from "../shared/connection";
import type { ConnectionMode } from "./connection-profiles";
import {
  addConnectionProfile,
  getActiveProfile,
  listConnectionProfiles,
  removeConnectionProfile,
  setActiveConnectionProfile,
} from "./connection-profiles";
import {
  getLocalApiOrigin,
  getLocalDashboardOrigin,
  startLocalServices,
  stopLocalServices,
} from "./services";

let mainWindow: BrowserWindow | null = null;
let connection: DesktopConnection | null = null;

interface WindowConfig {
  windowBounds?: { x: number; y: number; width: number; height: number };
  windowMaximized?: boolean;
}

function windowConfigFile(): string {
  return join(app.getPath("userData"), "window-state.json");
}

function readWindowConfig(): WindowConfig {
  try {
    const raw = readFileSync(windowConfigFile(), "utf8");
    return JSON.parse(raw) as WindowConfig;
  } catch {
    return {};
  }
}

function saveWindowConfig(config: WindowConfig): void {
  try {
    const file = windowConfigFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(config, null, 2), "utf8");
  } catch {
    // Ignore configuration save error
  }
}

function connectionFile(): string {
  return join(app.getPath("userData"), "connection.json");
}

async function readConnection(): Promise<DesktopConnection | null> {
  try {
    const raw = await readFile(connectionFile(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.origin === "string") {
      return { origin: normalizeUpstandOrigin(parsed.origin) };
    }
  } catch {
    // Ignore missing or corrupt configuration
  }
  return null;
}

async function saveConnection(next: DesktopConnection | null): Promise<void> {
  const file = connectionFile();
  await mkdir(dirname(file), { recursive: true });
  if (!next) {
    await rm(file, { force: true });
    return;
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(next), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, file);
}

function rendererPath(): string {
  const candidate1 = join(__dirname, "renderer", "index.html");
  if (existsSync(candidate1)) return candidate1;

  const candidate2 = join(app.getAppPath(), "dist", "renderer", "index.html");
  if (existsSync(candidate2)) return candidate2;

  return join(app.getAppPath(), "src", "renderer", "index.html");
}

function preloadPath(): string {
  const candidate1 = join(__dirname, "preload.cjs");
  if (existsSync(candidate1)) return candidate1;

  const candidate2 = join(app.getAppPath(), "dist", "preload.cjs");
  if (existsSync(candidate2)) return candidate2;

  const candidate3 = join(__dirname, "..", "preload.cjs");
  if (existsSync(candidate3)) return candidate3;

  return join(app.getAppPath(), "dist", "preload.cjs");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Loading screen
//
// Shown immediately on launch, so the window is never blank while we figure
// out whether to connect to a saved connection, the packaged local
// dashboard, or a dev server. It's a self-contained data: URL so it has zero
// dependency on build output or packaging paths — it always renders, even
// before the app has built anything.
// ---------------------------------------------------------------------------
const LOADING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  :root { color-scheme: dark; }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid;
    place-items: center;
    background: #09090b;
    color: #fafafa;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    user-select: none;
  }
  .drag-handle {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 36px;
    -webkit-app-region: drag;
  }
  .wrap { display: grid; justify-items: center; gap: 1.1rem; -webkit-app-region: no-drag; }
  .mark { font-size: 1.05rem; font-weight: 650; letter-spacing: 0.02em; opacity: 0.92; }
  .spinner {
    width: 32px; height: 32px; border-radius: 50%;
    border: 2.5px solid #27272a; border-top-color: #fafafa;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .status { font-size: 0.8rem; color: #71717a; min-height: 1.1em; }
</style>
</head>
<body>
  <div class="drag-handle"></div>
  <div class="wrap">
    <div class="spinner" role="status" aria-label="Loading"></div>
    <div class="mark">Upstand</div>
    <div class="status" id="status">Starting up…</div>
  </div>
</body>
</html>`;

function loadingScreenURL(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(LOADING_HTML)}`;
}

async function showLoadingScreen(): Promise<void> {
  if (!mainWindow) return;
  try {
    await mainWindow.loadURL(loadingScreenURL());
  } catch {
    // The loading screen itself can't meaningfully fail; ignore.
  }
}

// ---------------------------------------------------------------------------
// Origin resolution (no window navigation — pure network checks)
// ---------------------------------------------------------------------------

async function isReachable(url: string, timeoutMs = 1200): Promise<boolean> {
  const tryFetch = async (targetUrl: string) => {
    try {
      const response = await fetch(targetUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 0) return false;
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/plain") && !contentType.includes("html")) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  if (await tryFetch(url)) return true;
  if (url.includes("localhost")) {
    return await tryFetch(url.replace("localhost", "127.0.0.1"));
  }
  return false;
}

/**
 * Figures out which origin to load, without ever navigating the window.
 * Only once this resolves do we perform a single, final loadURL — so the
 * loading screen stays visible the entire time instead of the window
 * flickering through several failed navigation attempts.
 */
async function resolveStartupOrigin(): Promise<string | null> {
  if (connection && (await isReachable(connection.origin))) {
    return connection.origin;
  }

  const localDashboard = getLocalDashboardOrigin();
  if (localDashboard && (await isReachable(localDashboard))) {
    return localDashboard;
  }

  if (!app.isPackaged) {
    // Probe Web Dashboard dev server origins on port 3001
    const candidates = ["http://localhost:3001", "http://127.0.0.1:3001"];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      for (const origin of candidates) {
        if (await isReachable(origin)) {
          return origin;
        }
      }
      if (attempt < 29) await sleep(500);
    }
  }

  return null;
}

async function loadCurrentView(): Promise<void> {
  if (!mainWindow) return;
  await showLoadingScreen();

  const origin = await resolveStartupOrigin();
  if (origin) {
    try {
      const normalizedOrigin = normalizeUpstandOrigin(origin);
      if (!connection) {
        connection = { origin: normalizedOrigin };
      }
      await mainWindow.loadURL(new URL(origin).toString());
      return;
    } catch {
      // Fall through to the connect screen below.
    }
  }

  try {
    await mainWindow.loadFile(rendererPath());
  } catch {
    // Nothing further to fall back to.
  }
}

/**
 * User-initiated connection change (the connect screen, or "Change
 * connection…"). Unlike loadCurrentView, this must throw on failure so the
 * renderer can show a real error, and must never persist a connection that
 * didn't actually load.
 */
async function setConnection(origin: string): Promise<DesktopConnection> {
  const normalized = normalizeUpstandOrigin(origin);
  if (!mainWindow) {
    throw new Error("Window is not ready yet.");
  }
  await mainWindow.loadURL(new URL(normalized).toString());
  connection = { origin: normalized };
  await saveConnection(connection);
  return connection;
}

async function openExternalWebUrl(value: string): Promise<void> {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Unsupported URL protocol");
  }
  await shell.openExternal(url.toString());
}

function createWindow(): BrowserWindow {
  const winConfig = readWindowConfig();
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workAreaSize;

  const width = Math.min(
    winConfig.windowBounds?.width ?? 1440,
    workArea.width - 80,
  );
  const height = Math.min(
    winConfig.windowBounds?.height ?? 960,
    workArea.height - 80,
  );

  const hasStoredPosition =
    typeof winConfig.windowBounds?.x === "number" &&
    typeof winConfig.windowBounds?.y === "number";

  const window = new BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 560,
    ...(hasStoredPosition
      ? { x: winConfig.windowBounds?.x, y: winConfig.windowBounds?.y }
      : { center: true }),
    show: false,
    title: "Upstand",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#09090b" : "#ffffff",
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 18, y: 16 },
        }
      : { frame: false }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath(),
    },
  });

  if (winConfig.windowMaximized === true) {
    window.maximize();
  }

  const emitMaximized = (maximized: boolean) =>
    window.webContents.send("window:maximized-change", maximized);
  window.on("maximize", () => emitMaximized(true));
  window.on("unmaximize", () => emitMaximized(false));

  const emitNav = () => {
    const h = window.webContents.navigationHistory;
    window.webContents.send("window:nav-state-change", {
      canGoBack: h?.canGoBack() ?? false,
      canGoForward: h?.canGoForward() ?? false,
    });
  };
  window.webContents.on("did-navigate", emitNav);
  window.webContents.on("did-navigate-in-page", emitNav);

  // Fires after the loading screen's first paint, which is near-instant
  // since it's an inline data: URL — the window appears almost immediately
  // instead of waiting on the real app/dev server to respond.
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url, connection)) {
      void mainWindow?.loadURL(url).catch(() => undefined);
      return { action: "deny" };
    }
    void openExternalWebUrl(url).catch(() => undefined);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedNavigation(url, connection)) return;
    event.preventDefault();
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void openExternalWebUrl(url).catch(() => undefined);
    }
  });

  window.on("close", () => {
    saveWindowConfig({
      windowMaximized: window.isMaximized(),
      windowBounds: window.getNormalBounds(),
    });
  });

  return window;
}

function installMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Upstand",
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            label: "Change connection…",
            click: async () => {
              const window = mainWindow;
              if (!window) return;
              const response = await dialog.showMessageBox(window, {
                buttons: ["Open connection settings", "Cancel"],
                defaultId: 0,
                message: "Change the Upstand control-plane connection?",
                type: "question",
              });
              if (response.response === 0) {
                connection = null;
                await saveConnection(null);
                if (getLocalDashboardOrigin()) {
                  connection = { origin: getLocalDashboardOrigin() };
                }
                await loadCurrentView();
              }
            },
          },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
}

function validateIpcSender(event: Electron.IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl) return;
  try {
    const url = new URL(senderUrl);
    if (url.protocol === "data:") return;
    if (url.protocol === "file:") return;
    if (isAllowedNavigation(senderUrl, connection)) return;
  } catch {
    // Ignore invalid URLs
  }
  throw new Error("Unauthorized IPC invocation sender frame");
}

/**
 * All ipcMain.handle registrations live here so they can run BEFORE the
 * first navigation. The preload script fires as soon as any page (including
 * the loading screen) starts loading, so handlers must already exist.
 */
function registerIpcHandlers(): void {
  ipcMain.handle("connection:get", (event) => {
    validateIpcSender(event);
    return connection;
  });
  ipcMain.handle("connection:set", (event, origin: string) => {
    validateIpcSender(event);
    return setConnection(origin);
  });
  ipcMain.handle("connection:clear", async (event) => {
    validateIpcSender(event);
    await saveConnection(null);
    connection = getLocalDashboardOrigin()
      ? { origin: getLocalDashboardOrigin() }
      : null;
    await loadCurrentView();
  });

  // ------------------------------------------------------------------
  // Connection profiles — named, typed connections (desktop / self-hosted / cloud)
  // ------------------------------------------------------------------
  ipcMain.handle("connection:profiles:list", async (event) => {
    validateIpcSender(event);
    return listConnectionProfiles();
  });
  ipcMain.handle(
    "connection:profiles:add",
    async (
      event,
      opts: {
        name: string;
        mode: ConnectionMode;
        origin: string;
        setActive?: boolean;
      },
    ) => {
      validateIpcSender(event);
      const profile = await addConnectionProfile(opts);
      if (opts.setActive) {
        // Also switch the active connection window
        await setConnection(profile.origin);
      }
      return profile;
    },
  );
  ipcMain.handle("connection:profiles:remove", async (event, id: string) => {
    validateIpcSender(event);
    return removeConnectionProfile(id);
  });
  ipcMain.handle(
    "connection:profiles:set-active",
    async (event, id: string) => {
      validateIpcSender(event);
      const profile = await setActiveConnectionProfile(id);
      if (profile) {
        await setConnection(profile.origin);
      }
      return profile;
    },
  );
  ipcMain.handle("connection:mode:get", async (event) => {
    validateIpcSender(event);
    const profile = await getActiveProfile();
    // Fall back to "desktop" when there is no profile (local embedded mode)
    return profile?.mode ?? "desktop";
  });

  ipcMain.handle("local-api:get", (event) => {
    validateIpcSender(event);
    return getLocalApiOrigin();
  });
  ipcMain.handle("app:version", (event) => {
    validateIpcSender(event);
    return app.getVersion();
  });
  ipcMain.handle("app:open-external", async (event, value: string) => {
    validateIpcSender(event);
    await openExternalWebUrl(value);
  });

  ipcMain.handle("window:minimize", () => {
    mainWindow?.minimize();
    return true;
  });
  ipcMain.handle("window:toggle-maximize", () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle("window:close", () => {
    mainWindow?.close();
    return true;
  });
  ipcMain.handle(
    "window:is-maximized",
    () => mainWindow?.isMaximized() ?? false,
  );
  ipcMain.handle("window:nav-back", () => {
    const h = mainWindow?.webContents.navigationHistory;
    if (h?.canGoBack()) h.goBack();
    return {
      canGoBack: h?.canGoBack() ?? false,
      canGoForward: h?.canGoForward() ?? false,
    };
  });
  ipcMain.handle("window:nav-forward", () => {
    const h = mainWindow?.webContents.navigationHistory;
    if (h?.canGoForward()) h.goForward();
    return {
      canGoBack: h?.canGoBack() ?? false,
      canGoForward: h?.canGoForward() ?? false,
    };
  });
  ipcMain.handle("window:nav-reload", () => {
    mainWindow?.webContents.reload();
    return true;
  });
  ipcMain.handle("window:toggle-dev-tools", () => {
    mainWindow?.webContents.toggleDevTools();
    return true;
  });
  ipcMain.handle("window:nav-state", () => {
    const h = mainWindow?.webContents.navigationHistory;
    return {
      canGoBack: h?.canGoBack() ?? false,
      canGoForward: h?.canGoForward() ?? false,
    };
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    connection = await readConnection();

    ipcMain.on("local-api:get-sync", (event) => {
      event.returnValue = getLocalApiOrigin();
    });

    // Create the window and show the loading screen immediately — before
    // starting packaged local services (which can take a few seconds) and
    // before probing for a dev server. The user always sees something.
    mainWindow = createWindow();
    installMenu();
    registerIpcHandlers();
    await showLoadingScreen();

    if (app.isPackaged) {
      try {
        const local = await startLocalServices();
        if (!connection) connection = { origin: local.dashboardOrigin };
      } catch (error) {
        await dialog.showMessageBox({
          type: "error",
          title: "Upstand Desktop could not start",
          message: error instanceof Error ? error.message : String(error),
          detail:
            "The bundled control plane was not ready. Check the Desktop logs and restart the application.",
        });
      }
    }

    await loadCurrentView();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => {
    stopLocalServices();
  });
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      await loadCurrentView();
    }
  });
}
