"use client";

import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@xterm/xterm";

import { useTheme } from "next-themes";
import { downloadText } from "@/lib/browser";
import { getServerApiUrl } from "@/lib/server-url";

interface TerminalEmulatorProps {
  token: string;
  themeName?: "auto" | "slate" | "matrix" | "dracula" | "light";
  fontSize?: number;
  clearTrigger?: number;
  downloadTrigger?: number;
  onReady?: () => void;
  onClose?: (reason?: string) => void;
}

type TerminalControlMessage =
  | { type: "terminal.ready" }
  | { type: "terminal.error"; message: string };

function getTerminalSocketUrl(): string {
  const url = new URL(getServerApiUrl("/api/terminal/connect"));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function parseControlMessage(data: string): TerminalControlMessage | null {
  try {
    const message = JSON.parse(data) as Partial<TerminalControlMessage>;
    if (message.type === "terminal.ready") return { type: message.type };
    if (
      message.type === "terminal.error" &&
      typeof message.message === "string"
    ) {
      return { type: message.type, message: message.message };
    }
  } catch {
    // Regular terminal output is sent as binary, but preserve unexpected text.
  }
  return null;
}

export interface TerminalThemeOptions {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const TERMINAL_THEMES: Record<string, TerminalThemeOptions> = {
  slate: {
    background: "#080c0a",
    foreground: "#f1f5f9",
    cursor: "#22c55e",
    cursorAccent: "#080c0a",
    selectionBackground: "rgba(34, 197, 94, 0.3)",
    black: "#020617",
    red: "#ef4444",
    green: "#22c55e",
    yellow: "#eab308",
    blue: "#3b82f6",
    magenta: "#ec4899",
    cyan: "#06b6d4",
    white: "#cbd5e1",
    brightBlack: "#64748b",
    brightRed: "#f87171",
    brightGreen: "#4ade80",
    brightYellow: "#facc15",
    brightBlue: "#60a5fa",
    brightMagenta: "#f472b6",
    brightCyan: "#22d3ee",
    brightWhite: "#f8fafc",
  },
  matrix: {
    background: "#000000",
    foreground: "#00ff00",
    cursor: "#00ff00",
    cursorAccent: "#000000",
    selectionBackground: "rgba(0, 255, 0, 0.2)",
    black: "#000000",
    red: "#008800",
    green: "#00ff00",
    yellow: "#00ff00",
    blue: "#008800",
    magenta: "#008800",
    cyan: "#00ff00",
    white: "#00ff00",
    brightBlack: "#00ff00",
    brightRed: "#00ff00",
    brightGreen: "#00ff00",
    brightYellow: "#00ff00",
    brightBlue: "#00ff00",
    brightMagenta: "#00ff00",
    brightCyan: "#00ff00",
    brightWhite: "#00ff00",
  },
  dracula: {
    background: "#1e1f29",
    foreground: "#f8f8f2",
    cursor: "#f8f8f0",
    cursorAccent: "#282a36",
    selectionBackground: "rgba(68, 71, 90, 0.5)",
    black: "#000000",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#bfbfbf",
    brightBlack: "#4d4d4d",
    brightRed: "#ff6e67",
    brightGreen: "#5af78e",
    brightYellow: "#f4f99d",
    brightBlue: "#caa9fa",
    brightMagenta: "#ff92d0",
    brightCyan: "#9aedfe",
    brightWhite: "#e6e6e6",
  },
  light: {
    background: "#f8fafc",
    foreground: "#0f172a",
    cursor: "#0f172a",
    cursorAccent: "#f8fafc",
    selectionBackground: "rgba(15, 23, 42, 0.1)",
    black: "#0f172a",
    red: "#dc2626",
    green: "#16a34a",
    yellow: "#ca8a04",
    blue: "#2563eb",
    magenta: "#d946ef",
    cyan: "#0891b2",
    white: "#e2e8f0",
    brightBlack: "#475569",
    brightRed: "#ef4444",
    brightGreen: "#22c55e",
    brightYellow: "#eab308",
    brightBlue: "#3b82f6",
    brightMagenta: "#ec4899",
    brightCyan: "#06b6d4",
    brightWhite: "#cbd5e1",
  },
};

export function TerminalEmulator({
  token,
  themeName = "auto",
  fontSize = 13,
  clearTrigger = 0,
  downloadTrigger = 0,
  onReady,
  onClose,
}: TerminalEmulatorProps) {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const onReadyRef = useRef(onReady);
  const onCloseRef = useRef(onClose);

  const activeThemeKey =
    themeName === "auto"
      ? resolvedTheme === "light"
        ? "light"
        : "slate"
      : themeName;

  useEffect(() => {
    onReadyRef.current = onReady;
    onCloseRef.current = onClose;
  }, [onClose, onReady]);

  // Handle dynamic font size changes reactively
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.fontSize = fontSize;
    }
  }, [fontSize]);

  // Handle dynamic theme changes reactively
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme =
        TERMINAL_THEMES[activeThemeKey] || TERMINAL_THEMES.slate;
    }
  }, [activeThemeKey]);

  // Handle clear screen trigger
  useEffect(() => {
    if (termRef.current && clearTrigger > 0) {
      termRef.current.clear();
      termRef.current.focus();
    }
  }, [clearTrigger]);

  // Handle download scrollback buffer trigger
  useEffect(() => {
    if (termRef.current && downloadTrigger > 0) {
      const getTerminalBufferText = (term: Terminal): string => {
        const buffer = term.buffer.active;
        const lines: string[] = [];
        for (let i = 0; i < buffer.length; i++) {
          const line = buffer.getLine(i);
          if (line) {
            lines.push(line.translateToString(true));
          }
        }
        return lines.join("\n");
      };
      const text = getTerminalBufferText(termRef.current);
      downloadText(text, `terminal-buffer-${Date.now()}.txt`);
    }
  }, [downloadTrigger]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Only re-run when token changes
  useEffect(() => {
    let isMounted = true;
    let closingIntentionally = false;
    let connectionError: string | undefined;
    let ws: WebSocket | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function initTerminal() {
      // Lazily import xterm and fit addon to avoid SSR errors in Next.js
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      if (!isMounted || !containerRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize,
        lineHeight: 1.2,
        fontFamily:
          "Geist Mono, var(--font-geist-mono), ui-monospace, monospace",
        theme: TERMINAL_THEMES[activeThemeKey] || TERMINAL_THEMES.slate,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.open(containerRef.current);
      fitAddon.fit();

      termRef.current = term;

      ws = new WebSocket(getTerminalSocketUrl());
      ws.binaryType = "arraybuffer";

      ws.onmessage = async (event) => {
        if (typeof event.data === "string") {
          const controlMessage = parseControlMessage(event.data);
          if (controlMessage?.type === "terminal.ready") {
            term.focus();
            onReadyRef.current?.();
            return;
          }
          if (controlMessage?.type === "terminal.error") {
            connectionError = controlMessage.message;
            term.write(`\r\n\x1b[1;31m[${controlMessage.message}]\x1b[0m\r\n`);
            return;
          }
        }

        const text =
          typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(
                event.data instanceof Blob
                  ? await event.data.arrayBuffer()
                  : event.data,
              );
        term.write(text);
      };

      ws.onerror = () => {
        term.write("\r\n\x1b[1;31m[Terminal Connection Error]\x1b[0m\r\n");
      };

      ws.onclose = (e) => {
        if (closingIntentionally || !isMounted) return;
        const reason = connectionError || e.reason || "SSH session closed";
        term.write(`\r\n\x1b[1;31m[Disconnected: ${reason}]\x1b[0m\r\n`);
        onCloseRef.current?.(reason);
      };

      term.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // Handle Container resize dynamically via ResizeObserver
      resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
        } catch (_e) {
          // ignore fit issues during transitions
        }
      });
      resizeObserver.observe(containerRef.current);
    }

    initTerminal().catch((error) => {
      if (!isMounted) return;
      onCloseRef.current?.(
        error instanceof Error ? error.message : "Unable to start terminal",
      );
    });

    return () => {
      isMounted = false;
      closingIntentionally = true;
      if (ws) {
        ws.close();
      }
      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [token]);

  return (
    <div
      className="relative h-full w-full select-text p-2"
      style={{
        backgroundColor: TERMINAL_THEMES[themeName]?.background || "#080c0a",
      }}
    >
      <div ref={containerRef} className="h-full w-full overflow-hidden" />
    </div>
  );
}
