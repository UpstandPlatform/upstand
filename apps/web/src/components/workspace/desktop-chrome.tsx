"use client";

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  GearsFreeIcons,
  Menu01Icon,
  RefreshIcon,
  SquareIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@upstand/ui/components/dropdown-menu";
import { cn } from "@upstand/ui/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { useSystemConfig } from "@/hooks/use-system-config";

type NavState = { canGoBack: boolean; canGoForward: boolean };

type DesktopBridge = {
  isDesktop?: boolean;
  app?: { platform?: string };
  connection?: { openPicker: () => Promise<void> };
  window?: {
    minimize: () => Promise<unknown>;
    toggleMaximize: () => Promise<unknown>;
    close: () => Promise<unknown>;
    isMaximized: () => Promise<boolean>;
    onMaximizedChange: (cb: (maximized: boolean) => void) => () => void;
    back: () => Promise<unknown>;
    forward: () => Promise<unknown>;
    reload: () => Promise<unknown>;
    toggleDevTools?: () => Promise<unknown>;
    navState: () => Promise<NavState>;
    onNavStateChange: (cb: (s: NavState) => void) => () => void;
  };
};

const getBridge = (): DesktopBridge | undefined => {
  if (typeof window === "undefined") return undefined;
  return (
    (window as unknown as { desktop?: DesktopBridge }).desktop ??
    (window as unknown as { upstandDesktop?: DesktopBridge }).upstandDesktop
  );
};

function RuntimeStatus() {
  const { capabilities, isPending } = useSystemConfig();
  const mode = capabilities?.mode ?? "self-hosted";
  const label =
    mode === "desktop"
      ? "Local Desktop"
      : mode === "cloud"
        ? "Cloud control plane"
        : "Self-hosted";
  return (
    <Badge
      className="hidden max-w-44 truncate rounded-full px-2.5 font-normal sm:inline-flex"
      variant={isPending ? "outline" : "secondary"}
      title={
        isPending
          ? "Loading control-plane capabilities"
          : `Connected to ${label}`
      }
    >
      <span
        className={cn(
          "mr-1.5 size-1.5 rounded-full bg-emerald-500",
          isPending && "bg-amber-500",
        )}
      />
      {isPending ? "Connecting…" : label}
    </Badge>
  );
}

export function DesktopChrome() {
  const [ready, setReady] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [nav, setNav] = useState<NavState>({
    canGoBack: false,
    canGoForward: false,
  });

  useEffect(() => {
    const d = getBridge();
    const isElectronEnv =
      Boolean(d?.isDesktop) ||
      (typeof window !== "undefined" &&
        navigator.userAgent.toLowerCase().includes("electron"));
    if (!isElectronEnv) return;

    const mac =
      d?.app?.platform === "darwin" ||
      (typeof navigator !== "undefined" &&
        navigator.userAgent.toLowerCase().includes("macintosh"));
    setIsMac(mac);
    setReady(true);

    const root = document.documentElement;
    root.classList.add("is-desktop");
    if (mac) root.classList.add("is-desktop-mac");

    let offMax: (() => void) | undefined;
    let offNav: (() => void) | undefined;

    if (d?.window) {
      void d.window
        .isMaximized()
        .then(setMaximized)
        .catch(() => {});
      void d.window
        .navState()
        .then(setNav)
        .catch(() => {});
      offMax = d.window.onMaximizedChange(setMaximized);
      offNav = d.window.onNavStateChange(setNav);
    }

    return () => {
      offMax?.();
      offNav?.();
      root.classList.remove("is-desktop", "is-desktop-mac");
    };
  }, []);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    void getBridge()?.window?.toggleMaximize();
  }, []);

  if (!ready) return null;

  return (
    <header
      className={cn(
        "app-titlebar fixed top-0 right-0 left-0 z-50 flex h-9 shrink-0 select-none items-center border-b bg-background px-2",
        isMac ? "pl-20" : "pl-2",
      )}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      onDoubleClick={onDoubleClick}
    >
      <nav
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        aria-label="Navigation history"
      >
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={!nav.canGoBack}
          onClick={() => void getBridge()?.window?.back()}
          aria-label="Go back"
          title="Go back"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={!nav.canGoForward}
          onClick={() => void getBridge()?.window?.forward()}
          aria-label="Go forward"
          title="Go forward"
        >
          <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
        </Button>
        <RuntimeStatus />
      </nav>

      <div
        className="min-w-0 flex-1 self-stretch"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      {!isMac && (
        <div
          className="flex items-center gap-0.5"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Menu"
                />
              }
            >
              <HugeiconsIcon icon={Menu01Icon} className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => void getBridge()?.window?.reload()}
              >
                <HugeiconsIcon icon={RefreshIcon} className="mr-2 size-4" />
                Reload
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void getBridge()?.connection?.openPicker()}
              >
                <HugeiconsIcon icon={GearsFreeIcons} className="mr-2 size-4" />
                Switch runtime or connection
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void getBridge()?.window?.toggleDevTools?.()}
              >
                <HugeiconsIcon icon={GearsFreeIcons} className="mr-2 size-4" />
                Dev Tools
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => void getBridge()?.window?.minimize()}
            aria-label="Minimize"
            title="Minimize"
          >
            <span className="h-0.5 w-2.5 bg-current" />
          </Button>

          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => void getBridge()?.window?.toggleMaximize()}
            aria-label={maximized ? "Restore" : "Maximize"}
            title={maximized ? "Restore" : "Maximize"}
          >
            <HugeiconsIcon icon={SquareIcon} className="size-3" />
          </Button>

          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="hover:bg-destructive hover:text-destructive-foreground"
            onClick={() => void getBridge()?.window?.close()}
            aria-label="Close"
            title="Close"
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
          </Button>
        </div>
      )}
    </header>
  );
}
