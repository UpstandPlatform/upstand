"use client";

import { Sparkles, TerminalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@upstand/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@upstand/ui/components/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@upstand/ui/components/tooltip";
import { cn } from "@upstand/ui/lib/utils";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useState } from "react";
import {
  Download,
  MinusIcon,
  PlusIcon,
  Settings,
  Trash2,
} from "@/components/huge-icons";
import { TerminalEmulator } from "./terminal-emulator";

type TerminalThemeName = "auto" | "slate" | "matrix" | "dracula" | "light";

function isTerminalThemeName(value: string): value is TerminalThemeName {
  return (
    value === "auto" ||
    value === "slate" ||
    value === "matrix" ||
    value === "dracula" ||
    value === "light"
  );
}

export function TerminalDialogShell({
  open,
  onOpenChange,
  title,
  description,
  controls,
  token,
  connecting = false,
  emptyMessage,
  appearance = "standard",
  terminalLabel = "Interactive shell",
  onTerminalReady,
  onTerminalClose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  controls: ReactNode;
  token: string | null;
  connecting?: boolean;
  emptyMessage: string;
  appearance?: "standard" | "control-plane";
  terminalLabel?: string;
  onTerminalReady?: () => void;
  onTerminalClose: (reason?: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const [readyToken, setReadyToken] = useState<string | null>(null);
  const terminalReady = Boolean(token && readyToken === token);
  const terminalConnecting = connecting || Boolean(token && !terminalReady);

  const [themeName, setThemeName] = useState<TerminalThemeName>("auto");
  const [fontSize, setFontSize] = useState<number>(13);
  const [clearTrigger, setClearTrigger] = useState<number>(0);
  const [downloadTrigger, setDownloadTrigger] = useState<number>(0);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  // Close settings modal automatically when session token becomes active
  // On mobile (<1024px), open settings modal when disconnected so user can connect easily
  useEffect(() => {
    if (token) {
      setSettingsOpen(false);
    } else if (
      open &&
      typeof window !== "undefined" &&
      window.innerWidth < 1024
    ) {
      setSettingsOpen(true);
    }
  }, [open, token]);

  // Load configuration from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("upstand-terminal-theme");
      if (savedTheme) {
        if (isTerminalThemeName(savedTheme)) setThemeName(savedTheme);
      }
      const savedFontSize = localStorage.getItem("upstand-terminal-fontsize");
      if (savedFontSize) {
        const parsed = Number.parseInt(savedFontSize, 10);
        if (!Number.isNaN(parsed)) {
          setFontSize(parsed);
        }
      }
    }
  }, []);

  const handleThemeChange = (newTheme: typeof themeName) => {
    setThemeName(newTheme);
    localStorage.setItem("upstand-terminal-theme", newTheme);
  };

  const handleFontSizeChange = (newSize: number) => {
    setFontSize(newSize);
    localStorage.setItem("upstand-terminal-fontsize", String(newSize));
  };

  const activeTheme =
    themeName === "auto"
      ? resolvedTheme === "light"
        ? "light"
        : "slate"
      : themeName;

  const handleTerminalReady = () => {
    setReadyToken(token);
    onTerminalReady?.();
  };

  const handleTerminalClose = (reason?: string) => {
    setReadyToken(null);
    onTerminalClose(reason);
  };

  // Shared Terminal Sub-Toolbar for both layouts
  const renderTerminalToolbar = () => {
    if (!token) return null;
    const isLightTheme = activeTheme === "light";

    return (
      <TooltipProvider delay={200}>
        <div
          className={cn(
            "flex h-10 shrink-0 select-none items-center gap-2 border-b px-3.5 font-mono text-xs transition-colors",
            isLightTheme
              ? "border-slate-300 bg-slate-200 text-slate-700"
              : "border-white/10 bg-[#0d1310] text-slate-300",
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded font-semibold text-[11px]",
                isLightTheme
                  ? "bg-slate-300/80 text-emerald-700"
                  : "border border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
              )}
            >
              $_
            </span>
            <span
              className={cn(
                "max-w-50 truncate font-medium text-xs sm:max-w-[320px]",
                isLightTheme ? "text-slate-800" : "text-slate-200",
              )}
              title={terminalLabel}
            >
              {terminalLabel}
            </span>
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
          </div>

          {/* Spacer */}
          <div className="min-w-4 flex-1" />

          {/* Controls Group */}
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Font Size controls */}
            <div
              className={cn(
                "flex items-center gap-0.5 rounded-md border p-0.5 transition-colors",
                isLightTheme
                  ? "border-slate-300 bg-slate-100/80 text-slate-700"
                  : "border-white/10 bg-white/5 text-slate-300",
              )}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-6 w-6 rounded p-0 transition-colors",
                        isLightTheme
                          ? "text-slate-600 hover:bg-slate-300/60 hover:text-slate-900"
                          : "text-slate-400 hover:bg-white/10 hover:text-white",
                      )}
                      onClick={() =>
                        handleFontSizeChange(Math.max(10, fontSize - 1))
                      }
                      aria-label="Decrease font size"
                    >
                      <MinusIcon className="size-3" />
                    </Button>
                  }
                />
                <TooltipContent className="px-2 py-1 text-[10px]">
                  Decrease Font Size
                </TooltipContent>
              </Tooltip>

              <span className="min-w-7 px-1 text-center font-semibold text-[11px] tabular-nums">
                {fontSize}px
              </span>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-6 w-6 rounded p-0 transition-colors",
                        isLightTheme
                          ? "text-slate-600 hover:bg-slate-300/60 hover:text-slate-900"
                          : "text-slate-400 hover:bg-white/10 hover:text-white",
                      )}
                      onClick={() =>
                        handleFontSizeChange(Math.min(20, fontSize + 1))
                      }
                      aria-label="Increase font size"
                    >
                      <PlusIcon className="size-3" />
                    </Button>
                  }
                />
                <TooltipContent className="px-2 py-1 text-[10px]">
                  Increase Font Size
                </TooltipContent>
              </Tooltip>
            </div>

            <div
              className={cn(
                "h-4 w-px",
                isLightTheme ? "bg-slate-300" : "bg-white/10",
              )}
            />

            {/* Theme selection */}
            <Select
              value={themeName}
              onValueChange={(val) => {
                if (val && isTerminalThemeName(val)) handleThemeChange(val);
              }}
            >
              <SelectTrigger
                className={cn(
                  "!h-7 !rounded-md !border !px-2.5 !text-[11px] select-none font-mono shadow-none transition-colors",
                  isLightTheme
                    ? "!border-slate-300 !bg-slate-100/80 !text-slate-700 hover:!bg-slate-300/60"
                    : "!border-white/10 !bg-white/5 !text-slate-300 hover:!bg-white/10 hover:!text-white",
                )}
              >
                <HugeiconsIcon
                  icon={Sparkles}
                  className="mr-1.5 size-3 opacity-70"
                />
                <span className="capitalize">Theme: {themeName}</span>
              </SelectTrigger>
              <SelectContent
                align="end"
                className="!rounded-lg w-32 border-border/40 bg-popover p-1 text-popover-foreground shadow-lg"
              >
                {(["auto", "slate", "matrix", "dracula", "light"] as const).map(
                  (t) => (
                    <SelectItem
                      key={t}
                      value={t}
                      className="rounded-md px-2 py-1 text-[11px]"
                    >
                      <span className="capitalize">{t}</span>
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>

            <div
              className={cn(
                "h-4 w-px",
                isLightTheme ? "bg-slate-300" : "bg-white/10",
              )}
            />

            {/* Action Buttons */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-7 w-7 rounded-md p-0 transition-colors",
                      isLightTheme
                        ? "text-slate-600 hover:bg-slate-300/60 hover:text-slate-900"
                        : "text-slate-400 hover:bg-white/10 hover:text-white",
                    )}
                    onClick={() => setClearTrigger((c) => c + 1)}
                    aria-label="Clear terminal screen"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                }
              />
              <TooltipContent className="px-2 py-1 text-[10px]">
                Clear Terminal Screen
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-7 w-7 rounded-md p-0 transition-colors",
                      isLightTheme
                        ? "text-slate-600 hover:bg-slate-300/60 hover:text-slate-900"
                        : "text-slate-400 hover:bg-white/10 hover:text-white",
                    )}
                    onClick={() => setDownloadTrigger((d) => d + 1)}
                    aria-label="Download terminal log buffer"
                  >
                    <Download className="size-3.5" />
                  </Button>
                }
              />
              <TooltipContent className="px-2 py-1 text-[10px]">
                Download Scrollback History
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>
    );
  };

  // Reusable Connection Settings Dialog
  const settingsModal = (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-w-md p-5 sm:max-w-lg">
        <DialogHeader className="border-border/40">
          <DialogTitle className="flex items-center gap-2 font-semibold text-base">
            <Settings className="size-4 text-primary" />
            Connection Settings
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            Configure SSH connection parameters and credentials.
          </DialogDescription>
        </DialogHeader>
        <div>{controls}</div>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      {settingsModal}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[min(94svh,880px)] w-[calc(100%-1rem)] max-w-[min(96vw,88rem)] flex-col gap-0 overflow-hidden p-0 shadow-2xl transition-all sm:w-[calc(100%-2rem)] lg:min-w-[1000px] xl:min-w-[1200px]">
          <DialogHeader className="shrink-0 border-border/40 border-b bg-background px-4 py-2.5 pr-14 sm:px-6 sm:py-3.5 sm:pr-16">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <HugeiconsIcon
                  icon={TerminalIcon}
                  className="size-4.5 shrink-0 text-primary"
                />
                <DialogTitle className="truncate font-semibold text-base sm:text-lg">
                  {title}
                </DialogTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7.5 shrink-0 gap-1.5 px-2.5 text-xs"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings className="size-3.5" />
                  <span className="hidden sm:inline">Connection Settings</span>
                </Button>
              </div>
            </div>
            {description && (
              <DialogDescription className="mt-0.5 max-w-2xl truncate text-muted-foreground text-xs">
                {description}
              </DialogDescription>
            )}
          </DialogHeader>

          {/* Standard appearance horizontal controls toolbar when disconnected */}
          {appearance === "standard" && !token && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-border/60 border-b bg-muted/20 p-3 sm:p-4">
              {controls}
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/5 lg:flex-row">
            {/* Control-plane appearance connection settings sidebar when disconnected (desktop) */}
            {appearance === "control-plane" && !token && (
              <section
                aria-label="Connection settings"
                className="hidden shrink-0 overflow-y-auto border-border/60 border-r bg-muted/20 px-6 py-6 lg:block lg:w-[320px]"
              >
                <div className="space-y-4">
                  <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                    Connection settings
                  </h3>
                  {controls}
                </div>
              </section>
            )}

            {/* Terminal view - full width when connected */}
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col",
                !token ? "p-3 sm:p-4 lg:p-5" : "p-2 sm:p-3",
              )}
            >
              <div
                className={cn(
                  "flex h-full min-h-75 flex-1 flex-col overflow-hidden rounded-xl shadow-sm ring-1 ring-border/40 transition-colors",
                  activeTheme === "light" ? "bg-slate-100" : "bg-[#080c0a]",
                )}
              >
                {renderTerminalToolbar()}

                {/* Offline state header fallback */}
                {!token && (
                  <div className="flex h-10 shrink-0 items-center gap-2 border-white/10 border-b bg-[#0d1210] px-3.5 text-xs">
                    <HugeiconsIcon
                      icon={TerminalIcon}
                      className="size-3.5 text-slate-400"
                    />
                    <span className="truncate font-mono text-slate-400">
                      {terminalLabel}
                    </span>
                    <span className="ml-auto font-mono text-slate-500">
                      {terminalConnecting ? "opening…" : "offline"}
                    </span>
                  </div>
                )}

                <div className="relative min-h-0 flex-1 overflow-hidden">
                  {token ? (
                    <TerminalEmulator
                      token={token}
                      themeName={activeTheme}
                      fontSize={fontSize}
                      clearTrigger={clearTrigger}
                      downloadTrigger={downloadTrigger}
                      onReady={handleTerminalReady}
                      onClose={handleTerminalClose}
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                      <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 font-mono text-emerald-400 text-lg">
                        $_
                      </div>
                      <div className="flex max-w-sm flex-col gap-1">
                        <p className="font-medium text-slate-300 text-sm">
                          Terminal is offline
                        </p>
                        <p className="text-slate-500 text-xs leading-normal">
                          {emptyMessage}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
