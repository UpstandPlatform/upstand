export {};

declare global {
  interface Window {
    upstandDesktop: {
      connection: {
        get(): Promise<{ origin: string } | null>;
        set(origin: string): Promise<{ origin: string }>;
        clear(): Promise<void>;
      };
      app: {
        version(): Promise<string>;
        openExternal(url: string): Promise<void>;
      };
    };
  }
}
