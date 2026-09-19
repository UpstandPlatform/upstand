export type DesktopUpdateInfo = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  downloadUrl: string | null;
};

type DesktopBridge = {
  isDesktop?: boolean;
  app: {
    checkForUpdates: () => Promise<DesktopUpdateInfo>;
    installUpdate: (downloadUrl: string) => Promise<void>;
  };
};

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as Window & { desktop?: DesktopBridge }).desktop;
  return bridge?.isDesktop ? bridge : null;
}
