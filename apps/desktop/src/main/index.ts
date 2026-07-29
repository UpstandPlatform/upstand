import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import {
  type DesktopConnection,
  isAllowedNavigation,
  normalizeUpstandOrigin,
} from "../shared/connection";

let mainWindow: BrowserWindow | null = null;
let connection: DesktopConnection | null = null;

function connectionFile(): string {
  return join(app.getPath("userData"), "connection.json");
}

async function readConnection(): Promise<DesktopConnection | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(connectionFile(), "utf8"),
    );
    if (!parsed || typeof parsed !== "object" || !("origin" in parsed))
      return null;
    return { origin: normalizeUpstandOrigin(String(parsed.origin)) };
  } catch {
    return null;
  }
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
  return join(__dirname, "renderer", "index.html");
}

async function loadCurrentView(): Promise<void> {
  if (!mainWindow) return;
  if (connection) {
    await mainWindow.loadURL(connection.origin);
  } else {
    await mainWindow.loadFile(rendererPath());
  }
}

async function setConnection(origin: string): Promise<DesktopConnection> {
  connection = { origin: normalizeUpstandOrigin(origin) };
  await saveConnection(connection);
  await loadCurrentView();
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
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: "Upstand",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, "preload.cjs"),
    },
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
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
    mainWindow = createWindow();
    installMenu();
    await loadCurrentView();

    ipcMain.handle("connection:get", () => connection);
    ipcMain.handle("connection:set", (_event, origin: string) =>
      setConnection(origin),
    );
    ipcMain.handle("connection:clear", async () => {
      connection = null;
      await saveConnection(null);
      await loadCurrentView();
    });
    ipcMain.handle("app:version", () => app.getVersion());
    ipcMain.handle("app:open-external", async (_event, value: string) => {
      await openExternalWebUrl(value);
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      await loadCurrentView();
    }
  });
}
