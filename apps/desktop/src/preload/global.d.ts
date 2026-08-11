import type { DesktopConnection, DesktopRuntime } from "../shared/connection";

export type NavState = {
  canGoBack: boolean;
  canGoForward: boolean;
};

export type DesktopBridge = {
  isDesktop: boolean;
  app: {
    platform: string;
    version: () => Promise<string>;
    openExternal: (url: string) => Promise<void>;
  };
  connection: {
    get: () => Promise<DesktopConnection | null>;
    set: (
      origin: string,
      options?: { name?: string; mode?: DesktopRuntime["mode"] },
    ) => Promise<DesktopConnection>;
    clear: () => Promise<void>;
    openPicker: () => Promise<void>;
    profiles: {
      list: () => Promise<
        import("../shared/connection").DesktopConnectionProfile[]
      >;
      setActive: (
        id: string,
      ) => Promise<
        import("../shared/connection").DesktopConnectionProfile | null
      >;
    };
  };
  local: {
    apiOrigin: string;
  };
  runtime: DesktopRuntime;
  window: {
    minimize: () => Promise<unknown>;
    toggleMaximize: () => Promise<unknown>;
    close: () => Promise<unknown>;
    isMaximized: () => Promise<boolean>;
    onMaximizedChange: (cb: (maximized: boolean) => void) => () => void;
    back: () => Promise<unknown>;
    forward: () => Promise<unknown>;
    reload: () => Promise<unknown>;
    toggleDevTools: () => Promise<unknown>;
    navState: () => Promise<NavState>;
    onNavStateChange: (cb: (state: NavState) => void) => () => void;
  };
};

declare global {
  interface Window {
    desktop?: DesktopBridge;
    upstandDesktop?: DesktopBridge;
  }
}
