import { contextBridge, ipcRenderer } from "electron";

const localApiOrigin = ipcRenderer.sendSync("local-api:get-sync") as string;

const desktopBridge = {
  isDesktop: true,
  app: {
    platform: process.platform,
    version: () => ipcRenderer.invoke("app:version") as Promise<string>,
    openExternal: (url: string) =>
      ipcRenderer.invoke("app:open-external", url) as Promise<void>,
  },
  connection: {
    get: () => ipcRenderer.invoke("connection:get"),
    set: (origin: string) => ipcRenderer.invoke("connection:set", origin),
    clear: () => ipcRenderer.invoke("connection:clear"),
  },
  local: {
    apiOrigin: localApiOrigin,
  },
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () =>
      ipcRenderer.invoke("window:is-maximized") as Promise<boolean>,
    onMaximizedChange: (cb: (maximized: boolean) => void) => {
      const listener = (_e: unknown, val: boolean) => cb(val);
      ipcRenderer.on("window:maximized-change", listener);
      return () => {
        ipcRenderer.removeListener("window:maximized-change", listener);
      };
    },
    back: () => ipcRenderer.invoke("window:nav-back"),
    forward: () => ipcRenderer.invoke("window:nav-forward"),
    reload: () => ipcRenderer.invoke("window:nav-reload"),
    toggleDevTools: () => ipcRenderer.invoke("window:toggle-dev-tools"),
    navState: () =>
      ipcRenderer.invoke("window:nav-state") as Promise<{
        canGoBack: boolean;
        canGoForward: boolean;
      }>,
    onNavStateChange: (
      cb: (state: { canGoBack: boolean; canGoForward: boolean }) => void,
    ) => {
      const listener = (
        _e: unknown,
        state: { canGoBack: boolean; canGoForward: boolean },
      ) => cb(state);
      ipcRenderer.on("window:nav-state-change", listener);
      return () => {
        ipcRenderer.removeListener("window:nav-state-change", listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld("upstandDesktop", desktopBridge);
contextBridge.exposeInMainWorld("desktop", desktopBridge);
