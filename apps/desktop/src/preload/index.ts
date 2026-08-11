import { contextBridge, ipcRenderer } from "electron";
import type { ConnectionMode } from "../main/connection-profiles";
import type {
  DesktopConnectionProfile,
  DesktopRuntime,
} from "../shared/connection";

const localApiOrigin = ipcRenderer.sendSync("local-api:get-sync") as string;
const runtime = ipcRenderer.sendSync(
  "connection:runtime:get-sync",
) as DesktopRuntime;

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
    set: (
      origin: string,
      options?: { name?: string; mode?: DesktopRuntime["mode"] },
    ) => ipcRenderer.invoke("connection:set", origin, options),
    clear: () => ipcRenderer.invoke("connection:clear"),
    openPicker: () => ipcRenderer.invoke("connection:picker:open"),
    /** List all saved named connection profiles. */
    profiles: {
      list: () =>
        ipcRenderer.invoke("connection:profiles:list") as Promise<
          DesktopConnectionProfile[]
        >,
      add: (opts: {
        name: string;
        mode: ConnectionMode;
        origin: string;
        setActive?: boolean;
      }) =>
        ipcRenderer.invoke(
          "connection:profiles:add",
          opts,
        ) as Promise<DesktopConnectionProfile>,
      remove: (id: string) =>
        ipcRenderer.invoke(
          "connection:profiles:remove",
          id,
        ) as Promise<boolean>,
      setActive: (id: string) =>
        ipcRenderer.invoke(
          "connection:profiles:set-active",
          id,
        ) as Promise<DesktopConnectionProfile | null>,
    },
    /** Returns the runtime mode of the currently active profile. */
    getMode: () =>
      ipcRenderer.invoke("connection:mode:get") as Promise<ConnectionMode>,
  },
  local: {
    apiOrigin: localApiOrigin,
  },
  runtime,
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
