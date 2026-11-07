export type DesktopUpdateInfo = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  canUpdate: boolean;
  releaseUrl: string | null;
  unavailableReason: string | null;
};

export type DesktopUpdateProgress = {
  phase: "downloading" | "installing";
  downloadedBytes: number | null;
  totalBytes: number | null;
  percent: number | null;
};

type DesktopBridge = {
  isDesktop?: boolean;
  app: {
    openExternal: (url: string) => Promise<void>;
    checkForUpdates: () => Promise<DesktopUpdateInfo>;
    installUpdate: () => Promise<void>;
    onUpdateProgress: (
      callback: (progress: DesktopUpdateProgress) => void,
    ) => () => void;
  };
};

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as Window & { desktop?: DesktopBridge }).desktop;
  return bridge?.isDesktop ? bridge : null;
}
