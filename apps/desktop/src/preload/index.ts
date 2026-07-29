import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("upstandDesktop", {
  connection: {
    get: () => ipcRenderer.invoke("connection:get"),
    set: (origin: string) => ipcRenderer.invoke("connection:set", origin),
    clear: () => ipcRenderer.invoke("connection:clear"),
  },
  app: {
    version: () => ipcRenderer.invoke("app:version"),
    openExternal: (url: string) => ipcRenderer.invoke("app:open-external", url),
  },
});
