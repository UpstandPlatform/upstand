import type { DesktopConnection } from "../shared/connection";

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
    set: (origin: string) => Promise<DesktopConnection>;
    clear: () => Promise<void>;
  };
  local: {
    apiOrigin: string;
  };
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
