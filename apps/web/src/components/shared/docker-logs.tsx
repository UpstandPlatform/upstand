import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@upstand/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@upstand/ui/components/select";
import { cn } from "@upstand/ui/lib/utils";
import {
  type ComponentProps,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  Bot,
  Clock,
  Copy,
  Download,
  Filter,
  Hash,
  Pause,
  Play,
  RefreshCw,
  Search,
  XCircle,
} from "@/components/huge-icons";
import { CodeSurface } from "@/components/shared/code-editor";
import { copyText, downloadText } from "@/lib/browser";
import { askUpGalWithLogs } from "@/lib/upgal-events";

export function stripAnsi(str: string): string {
  const ansiRegex =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence parser intentionally matches control characters.
    /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  return str.replace(ansiRegex, "");
}

// Log parser and style rules
export type LogType = "error" | "warning" | "success" | "info" | "debug";
export type LogVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

export interface LogLine {
  id: number;
  rawTimestamp: string | null;
  timestamp: Date | null;
  message: string;
  /**
   * Optional human-friendly rendering for structured (JSON) logs — e.g. a
   * MongoDB/pino-style line's extracted "[component] msg" instead of the raw
   * JSON blob. `message` always stays the full raw text (used for search and
   * export); this is display-only.
   */
  displayMessage?: string;
  /** Severity resolved once at parse time — never recomputed on every render/filter pass. */
  type: LogType;
}

interface LogStyle {
  type: LogType;
  variant: LogVariant;
}

const LOG_STYLES: Record<LogType, LogStyle> = {
  error: {
    type: "error",
    variant: "destructive",
  },
  warning: {
    type: "warning",
    variant: "secondary",
  },
  debug: {
    type: "debug",
    variant: "outline",
  },
  success: {
    type: "success",
    variant: "default",
  },
  info: {
    type: "info",
    variant: "secondary",
  },
} as const;

/**
 * Normalizes a structured "level"/"severity" field (as found on JSON log lines)
 * to one of our LogType buckets. Returns null if it isn't recognizable.
 */
const normalizeLevelHint = (raw: unknown): LogType | null => {
  if (typeof raw === "number") {
    // Common numeric level conventions (e.g. pino/bunyan): higher = more severe
    if (raw >= 50) return "error";
    if (raw >= 40) return "warning";
    if (raw >= 30) return "info";
    return "debug";
  }
  if (typeof raw !== "string") return null;
  const trimmedRaw = raw.trim();

  // MongoDB-style single-letter severity codes, e.g. "s":"I"/"W"/"E"/"F",
  // and the "D1".."D5" verbose-debug variants used by newer mongod versions.
  if (/^[a-z]\d?$/i.test(trimmedRaw)) {
    const code = trimmedRaw[0].toUpperCase();
    if (code === "E" || code === "F") return "error";
    if (code === "W") return "warning";
    if (code === "D") return "debug";
    if (code === "I") return "info";
  }

  const lvl = trimmedRaw.toLowerCase();
  if (["fatal", "panic", "error", "err", "critical", "crit"].includes(lvl))
    return "error";
  if (["warn", "warning"].includes(lvl)) return "warning";
  if (["ok", "success", "successful", "done"].includes(lvl)) return "success";
  if (["debug", "trace", "verbose", "silly"].includes(lvl)) return "debug";
  if (["info", "information", "notice", "log"].includes(lvl)) return "info";
  return null;
};

/**
 * Classifies a log message into a LogStyle. Priority order matters a lot here:
 * a message that mentions both an error and an incidental "status:"/"state:" word
 * must still be flagged as an error, so severity-bearing checks (structured hint,
 * HTTP status code, then error/warning) always run before the softer, broader
 * info/debug heuristics.
 *
 * @param message the raw log message
 * @param levelHint an explicit level already extracted from structured (JSON) data,
 *   which — when present — is trusted over any text heuristic.
 */
export const getLogType = (
  message: string,
  levelHint?: LogType | null,
): LogStyle => {
  if (levelHint) return LOG_STYLES[levelHint];

  const statusMatch = message.match(/"statusCode"\s*:\s*"?(\d{3})"?/);
  if (statusMatch) {
    const statusCode = Number(statusMatch[1]);
    if (statusCode >= 500) return LOG_STYLES.error;
    if (statusCode >= 400) return LOG_STYLES.warning;
    if (statusCode >= 200 && statusCode < 300) return LOG_STYLES.success;
    return LOG_STYLES.info;
  }

  const lowerMessage = message.toLowerCase();

  // 1. Errors first — highest severity, and must win over any incidental
  //    "status"/"state"/"info:" wording elsewhere in the same line.
  if (
    /(?:^|\s)(?:error|err):?\s/i.test(lowerMessage) ||
    /\b(?:exception|failed|failure)\b/i.test(lowerMessage) ||
    /(?:stack\s?trace):\s*$/i.test(lowerMessage) ||
    /^\s*at\s+[\w.]+\s*\(?.+:\d+:\d+\)?/.test(lowerMessage) ||
    /\b(?:uncaught|unhandled)\s+(?:exception|error)\b/i.test(lowerMessage) ||
    /Error:\s.*(?:in|at)\s+.*:\d+(?::\d+)?/.test(lowerMessage) ||
    /\b(?:errno|code):\s*(?:\d+|[A-Z_]+)\b/i.test(lowerMessage) ||
    /\[(?:error|err|fatal)\]/i.test(lowerMessage) ||
    /\b(?:crash|critical|fatal|broken)\b/i.test(lowerMessage)
  ) {
    return LOG_STYLES.error;
  }

  // 2. Warnings next.
  if (
    /(?:^|\s)(?:warning|warn):?\s/i.test(lowerMessage) ||
    /\[(?:warn(?:ing)?|attention)\]/i.test(lowerMessage) ||
    /(?:deprecated|obsolete)\s+(?:since|in|as\s+of)/i.test(lowerMessage) ||
    /\b(?:caution|attention|notice):\s/i.test(lowerMessage) ||
    /(?:might|may|could)\s+(?:not|cause|lead\s+to)/i.test(lowerMessage) ||
    /(?:!+\s*(?:warning|caution|attention)\s*!+)/i.test(lowerMessage) ||
    /\b(?:deprecated|obsolete|unstable|experimental)\b/i.test(lowerMessage) ||
    /⚠|⚠️/i.test(lowerMessage)
  ) {
    return LOG_STYLES.warning;
  }

  // 3. Success — explicit completion/readiness signals only, so a line like
  //    "still starting, not active yet" doesn't get mislabeled.
  if (
    /(?:successfully|complete[d]?)\s+(?:initialized|started|completed|created|done|deployed)/i.test(
      lowerMessage,
    ) ||
    /\[(?:success|ok|done)\]/i.test(lowerMessage) ||
    /(?:listening|running)\s+(?:on|at)\s+(?:port\s+)?\d+/i.test(lowerMessage) ||
    /(?:connected|established|ready)\s+(?:to|for|on)/i.test(lowerMessage) ||
    /\b(?:loaded|mounted|initialized)\s+successfully\b/i.test(lowerMessage) ||
    /✓|√|✅|\[ok\]|done!/i.test(lowerMessage) ||
    /\bsuccess(?:ful(?:ly)?)?\b/i.test(lowerMessage)
  ) {
    return LOG_STYLES.success;
  }

  // 4. Debug — requires an explicit debug/trace marker. (Deliberately narrower
  //    than before: generic words like "get"/"config"/"HTTP" used to catch
  //    ordinary request logs and mislabel them as debug noise.)
  if (
    /(?:^|\s)(?:debug|trace|verbose):?\s/i.test(lowerMessage) ||
    /\[(?:debug|trace|verbose)\]/i.test(lowerMessage)
  ) {
    return LOG_STYLES.debug;
  }

  // 5. Info — explicit info markers, or general status/progress narration.
  if (
    /(?:^|\s)(?:info|inf|information):?\s/i.test(lowerMessage) ||
    /\[(?:info|information|log)\]/i.test(lowerMessage) ||
    /\b(?:status|state|current|progress)\b:?\s/i.test(lowerMessage) ||
    /\b(?:processing|executing|performing|started|starting)\b/i.test(
      lowerMessage,
    )
  ) {
    return LOG_STYLES.info;
  }

  return LOG_STYLES.info;
};

export function cleanLogLineString(line: string): string {
  if (!line) return "";
  return (
    stripAnsi(line)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Log sanitizer intentionally matches control characters.
      .replace(/^[\x00-\x1F\x7F-\x9F\uFFFD!]+(?=\d{4}-\d{2}-\d{2}T)/g, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Log sanitizer intentionally matches control characters.
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uFFFD]+/g, "")
  );
}

const parseLogLine = (line: string, id: number): LogLine => {
  const cleaned = cleanLogLineString(line);
  const trimmed = cleaned.trim();
  if (!trimmed) {
    return {
      id,
      rawTimestamp: null,
      timestamp: null,
      message: cleaned,
      type: "info",
    };
  }

  // 1. JSON logs (e.g. Caddy logs, pino/bunyan, or MongoDB's own structured
  // format, which uses "s" for severity and a nested "t":{"$date":...} timestamp
  // instead of the more common top-level "level"/"ts" fields).
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);

      const levelHint = normalizeLevelHint(
        parsed.level ??
          parsed.severity ??
          parsed.lvl ??
          parsed.logLevel ??
          parsed.s,
      );

      const rawTsCandidate =
        parsed.ts ??
        parsed.time ??
        parsed.timestamp ??
        parsed["@timestamp"] ??
        parsed.t?.$date ??
        parsed.t?.date;

      let date: Date | null = null;
      if (typeof rawTsCandidate === "number") {
        const ms =
          rawTsCandidate < 1e11 ? rawTsCandidate * 1000 : rawTsCandidate;
        date = new Date(ms);
      } else if (typeof rawTsCandidate === "string") {
        date = new Date(rawTsCandidate);
      }
      const validDate = date && !Number.isNaN(date.getTime()) ? date : null;

      // Structured logs usually carry a short component tag ("c") and a
      // human-readable "msg" — surface those instead of the raw JSON blob.
      // Reuses the existing "[Component] message" bracket convention, so it
      // automatically picks up the same colored service badge as plain-text
      // logs like "[api] request handled".
      const component = typeof parsed.c === "string" ? parsed.c : null;
      const msgText = typeof parsed.msg === "string" ? parsed.msg : null;
      const displayMessage = msgText
        ? component
          ? `[${component}] ${msgText}`
          : msgText
        : undefined;

      return {
        id,
        rawTimestamp: validDate ? String(rawTsCandidate) : null,
        timestamp: validDate,
        message: cleaned,
        displayMessage,
        type: getLogType(cleaned, levelHint).type,
      };
    } catch {
      // Fall back to pattern matching if JSON parse fails
    }
  }

  // 2. ISO 8601 or Date at start: "2026-07-21T05:30:00...", "2026-07-21 05:30:00...", "[2026-07-21T05:30:00Z]..."
  const dateMatch = trimmed.match(
    /^(?:\[)?(\d{4}[-/]\d{2}[-/]\d{2}(?:[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?)(?:\])?\s*(.*)$/i,
  );
  if (dateMatch?.[1]) {
    const rawTs = dateMatch[1];
    const date = new Date(rawTs);
    if (!Number.isNaN(date.getTime())) {
      const message = dateMatch[2] || cleaned;
      return {
        id,
        rawTimestamp: rawTs,
        timestamp: date,
        message,
        type: getLogType(message).type,
      };
    }
  }

  // 3. Syslog date pattern at start: "Jul 21 05:30:00 message..."
  const syslogMatch = trimmed.match(
    /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(.*)$/,
  );
  if (syslogMatch?.[1]) {
    const rawTs = syslogMatch[1];
    const date = new Date(rawTs);
    if (!Number.isNaN(date.getTime())) {
      const message = syslogMatch[2] || cleaned;
      return {
        id,
        rawTimestamp: rawTs,
        timestamp: date,
        message,
        type: getLogType(message).type,
      };
    }
  }

  // 4. Time-only pattern at start: "05:30:00" or "[05:30:00]"
  const timeOnlyMatch = trimmed.match(
    /^(?:\[)?(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:\])?\s*(.*)$/,
  );
  if (timeOnlyMatch?.[1]) {
    const today = new Date().toISOString().split("T")[0];
    const date = new Date(`${today}T${timeOnlyMatch[1]}`);
    if (!Number.isNaN(date.getTime())) {
      const message = timeOnlyMatch[2] || cleaned;
      return {
        id,
        rawTimestamp: timeOnlyMatch[1],
        timestamp: date,
        message,
        type: getLogType(message).type,
      };
    }
  }

  return {
    id,
    rawTimestamp: null,
    timestamp: null,
    message: cleaned,
    type: getLogType(cleaned).type,
  };
};

const getServiceColor = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "text-blue-400 border-blue-500/20 bg-blue-500/10",
    "text-emerald-400 border-emerald-500/20 bg-emerald-500/10",
    "text-purple-400 border-purple-500/20 bg-purple-500/10",
    "text-pink-400 border-pink-500/20 bg-pink-500/10",
    "text-amber-400 border-amber-500/20 bg-amber-500/10",
    "text-cyan-400 border-cyan-500/20 bg-cyan-500/10",
    "text-indigo-400 border-indigo-500/20 bg-indigo-500/10",
    "text-violet-400 border-violet-500/20 bg-violet-500/10",
  ];
  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

// Individual terminal line component with highlighting and tooltip.
// Memoized: with severity resolved once at parse time, a line only needs to
// re-render when its own props actually change (search term, font size, etc.),
// not on every parent re-render or filter pass.
export const TerminalLine = memo(function TerminalLine({
  log,
  noTimestamp,
  searchTerm,
  fontSize = "sm",
}: {
  log: LogLine;
  noTimestamp?: boolean;
  searchTerm?: string;
  fontSize?: "sm" | "md" | "lg";
}) {
  const { timestamp, type } = log;
  const message = log.displayMessage ?? log.message;
  const variant = LOG_STYLES[type].variant;

  const serviceMatch = message.match(/^\[([^\]]+)\]\s*(.*)$/);
  const servicePrefix = serviceMatch ? serviceMatch[1] : null;
  const displayMessage = serviceMatch ? serviceMatch[2] : message;

  const formattedTime = timestamp
    ? timestamp.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "---";

  const highlightMessage = (text: string, term: string) => {
    const trimmedTerm = term.trim();
    if (!trimmedTerm) return text;

    const expression = new RegExp(
      `(${trimmedTerm.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")})`,
      "gi",
    );
    return text.split(expression).map((part, index) =>
      index % 2 === 1 ? (
        <mark
          className="rounded bg-warning/30 px-0.5 font-semibold text-foreground"
          key={`${part}-${index}`}
        >
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };

  return (
    <div
      className={cn(
        "flex gap-3 border-l-2 px-2 py-0.5 font-mono leading-normal transition-colors",
        type === "error"
          ? "border-destructive bg-destructive/5 hover:bg-destructive/10"
          : type === "warning"
            ? "border-warning bg-warning/5 hover:bg-warning/10"
            : type === "debug"
              ? "border-muted-foreground/30 bg-muted/20 hover:bg-muted/40"
              : type === "success"
                ? "border-primary bg-primary/5 hover:bg-primary/10"
                : "border-transparent hover:bg-muted/30",
      )}
    >
      {!noTimestamp && (
        <span
          className={cn(
            "shrink-0 select-none self-center font-mono text-muted-foreground tabular-nums",
            fontSize === "sm"
              ? "w-14 text-[9px]"
              : fontSize === "md"
                ? "w-16 text-[10px]"
                : "w-20 text-xs",
          )}
        >
          {formattedTime}
        </span>
      )}
      <Badge
        variant={variant}
        className="h-4.5 w-14 shrink-0 select-none justify-center self-center px-1 py-0 font-bold text-[8.5px] capitalize tracking-wide"
      >
        {type}
      </Badge>
      {servicePrefix && (
        <span
          className={cn(
            "inline-flex h-4.5 shrink-0 select-none items-center justify-center self-center rounded border px-1.5 font-bold font-mono text-[8px] uppercase tracking-wider",
            getServiceColor(servicePrefix),
          )}
        >
          {servicePrefix}
        </span>
      )}
      <span
        className={cn(
          "flex-1 whitespace-pre-wrap break-all font-mono text-foreground leading-relaxed",
          fontSize === "sm"
            ? "text-[10px]"
            : fontSize === "md"
              ? "text-xs"
              : "text-sm",
        )}
      >
        {highlightMessage(displayMessage, searchTerm || "")}
      </span>
    </div>
  );
});

export interface DockerLogsProps {
  containerId: string;
  logs?: string[] | string;
  isFetching?: boolean;
  emptyMessage?: string;
  className?: string;
  maxHeightClass?: string;
}

// How many parsed lines we keep in memory at most. Keeps long-running streams
// from growing unbounded even if the caller never truncates `logs` upstream.
const MAX_RETAINED_LOGS = 2000;

export const ShowDockerLogs = ({
  containerId,
  logs,
  isFetching = false,
  emptyMessage = "No matching logs found.",
  className,
  maxHeightClass = "h-[min(28rem,60svh)]",
}: DockerLogsProps) => {
  const [logsList, setLogsList] = useState<LogLine[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<LogLine[]>([]);
  const [linesLimit, setLinesLimit] = useState<number>(100);
  const [timeRange, setTimeRange] = useState<string>("all");
  const [showTimestamp, setShowTimestamp] = useState<boolean>(true);
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [fontSize, setFontSize] = useState<"sm" | "md" | "lg">("sm");

  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [messageBuffer, setMessageBuffer] = useState<LogLine[]>([]);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [showScrollBottomBtn, setShowScrollBottomBtn] =
    useState<boolean>(false);
  const [unseenCount, setUnseenCount] = useState<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rawLogsArray = useMemo(() => {
    if (!logs) return [];
    if (Array.isArray(logs)) return logs;
    return logs.split(/\r?\n/);
  }, [logs]);

  // Incremental parse cache: when new logs are just an append to what we saw
  // last time (the common "tail -f" case), we only parse the new suffix
  // instead of re-parsing the entire history on every update. Falls back to a
  // full re-parse whenever the incoming array isn't a superset of the last one
  // (container restarted, log source reset, filtered upstream, etc).
  const parsedCacheRef = useRef<LogLine[]>([]);
  const prevRawRef = useRef<string[]>([]);
  const idCounterRef = useRef(0);

  const currentParsed = useMemo(() => {
    const prevRaw = prevRawRef.current;
    const isAppendOnly =
      rawLogsArray.length >= prevRaw.length &&
      prevRaw.every((line, i) => rawLogsArray[i] === line);

    if (isAppendOnly) {
      const newLines = rawLogsArray.slice(prevRaw.length);
      const newParsed = newLines
        .filter((line) => Boolean(line?.trim()))
        .map((line) => parseLogLine(line, idCounterRef.current++));
      parsedCacheRef.current =
        newParsed.length > 0
          ? [...parsedCacheRef.current, ...newParsed].slice(-MAX_RETAINED_LOGS)
          : parsedCacheRef.current;
    } else {
      idCounterRef.current = 0;
      parsedCacheRef.current = rawLogsArray
        .filter((line) => Boolean(line?.trim()))
        .map((line) => parseLogLine(line, idCounterRef.current++))
        .slice(-MAX_RETAINED_LOGS);
    }

    prevRawRef.current = rawLogsArray;
    return parsedCacheRef.current;
  }, [rawLogsArray]);

  // Apply the freshly (incrementally) parsed lines, respecting pause/scroll state.
  useEffect(() => {
    if (!isPaused) {
      if (!autoScroll && logsList.length > 0) {
        const diff = currentParsed.length - logsList.length;
        if (diff > 0) {
          setUnseenCount((prev) => prev + diff);
        }
      }
      setLogsList(currentParsed);
      setMessageBuffer([]);
    } else {
      setMessageBuffer(currentParsed);
      const diff = currentParsed.length - logsList.length;
      if (diff > 0) {
        setUnseenCount((prev) => prev + diff);
      }
    }
    // logsList intentionally excluded: we only want to react to new parsed
    // data or a pause/autoScroll toggle, not to our own writes to logsList.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaused, currentParsed, autoScroll, logsList.length]);

  // Severity counts for the level filter — reads the precomputed `type`
  // instead of re-running detection regexes over every line on every render.
  const levelCounts = useMemo(() => {
    const counts = { info: 0, success: 0, warning: 0, debug: 0, error: 0 };
    for (const log of logsList) {
      counts[log.type]++;
    }
    return counts;
  }, [logsList]);

  // Filter implementation
  useEffect(() => {
    let result = logsList;

    // Search query filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((log) =>
        log.message.toLowerCase().includes(query),
      );
    }

    // Time range filter
    if (timeRange !== "all") {
      const cutoff = new Date();
      if (timeRange === "1h") cutoff.setHours(cutoff.getHours() - 1);
      else if (timeRange === "6h") cutoff.setHours(cutoff.getHours() - 6);
      else if (timeRange === "24h") cutoff.setHours(cutoff.getHours() - 24);
      result = result.filter((log) => log.timestamp && log.timestamp >= cutoff);
    }

    // Log type filter — no detection work here, just reads log.type
    if (typeFilters.length > 0) {
      result = result.filter((log) => typeFilters.includes(log.type));
    }

    // Apply lines limit
    result = result.slice(-linesLimit);

    setFilteredLogs(result);
  }, [logsList, searchQuery, timeRange, typeFilters, linesLimit]);

  // Scroll to bottom trigger
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setUnseenCount(0);
    }
  }, [autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
    setAutoScroll(isAtBottom);
    setShowScrollBottomBtn(!isAtBottom);
    if (isAtBottom) {
      setUnseenCount(0);
    }
  };

  const handlePauseResume = () => {
    if (isPaused) {
      if (messageBuffer.length > 0) {
        setLogsList(messageBuffer.slice(-MAX_RETAINED_LOGS));
        setMessageBuffer([]);
      }
      setUnseenCount(0);
    }
    setIsPaused(!isPaused);
  };

  const formatLogForExport = useCallback(
    (log: LogLine) =>
      showTimestamp
        ? `${log.timestamp?.toLocaleTimeString() || "---"} [${log.type}] ${log.message}`
        : log.message,
    [showTimestamp],
  );

  const handleCopy = () => {
    const text = filteredLogs.map(formatLogForExport).join("\n");
    void copyText(text)
      .then(() => toast.success("Logs copied to clipboard"))
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error ? error.message : "Could not copy logs",
        ),
      );
  };

  const handleDownload = () => {
    const text = filteredLogs.map(formatLogForExport).join("\n");
    downloadText(text, `container-${containerId}-logs.txt`);
  };

  const snapToBottom = () => {
    setAutoScroll(true);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    setUnseenCount(0);
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-4", className)}>
      {/* Filters & Control bar */}
      <div className="flex flex-col gap-2 rounded-xl border border-border/40 bg-card/60 p-2 text-xs">
        {/* Tier 1: primary actions + search + stream controls — always front and center */}
        <div className="flex flex-wrap items-center gap-1.5">
          {isFetching && (
            <span className="inline-flex shrink-0 animate-pulse items-center gap-1 font-medium font-mono text-[10px] text-primary">
              <RefreshCw className="size-3 animate-spin" />
              <span className="hidden sm:inline">Refreshing…</span>
            </span>
          )}

          {/* Ask UpGal AI Button — primary action, stays first and full-weight */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const linesToAttach = filteredLogs.slice(-100);
              const logsText = linesToAttach.map(formatLogForExport).join("\n");
              if (!logsText.trim()) {
                toast.error("No logs available to attach");
                return;
              }
              askUpGalWithLogs(
                logsText,
                `Please analyze these container logs (container: ${containerId}) and explain any errors, warnings, or anomalies:`,
              );
              toast.success("Logs attached to UpGal assistant");
            }}
            className="h-8 shrink-0 gap-1.5 border-primary/40 bg-primary/5 font-medium text-primary text-xs hover:bg-primary/10 active:scale-[0.98]"
            title="Attach recent logs (up to 100 lines) to UpGal assistant"
          >
            <Bot className="size-3.5" />
            <span>Ask UpGal</span>
          </Button>

          {/* Search bar — grows to fill available space, never gets squeezed out */}
          <InputGroup className="h-8 min-w-30 flex-1">
            <InputGroupAddon align="inline-start">
              <Search className="pointer-events-none size-3.5 text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search logs…"
              aria-label="Search logs"
              className="font-mono text-xs"
              spellCheck={false}
              autoComplete="off"
            />
            {searchQuery && (
              <InputGroupAddon align="inline-end">
                <span className="select-none rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                  {filteredLogs.length}
                </span>
                <InputGroupButton
                  size="icon-xs"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search query"
                >
                  <XCircle className="size-3.5" />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>

          {/* Stream + export controls — grouped together, right-aligned */}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePauseResume}
              className="h-8 gap-1.5 border-border/40 px-2.5 text-xs"
              aria-label={isPaused ? "Resume log stream" : "Pause log stream"}
              title={isPaused ? "Resume stream" : "Pause stream"}
            >
              {isPaused ? (
                <Play className="size-3.5 text-primary" />
              ) : (
                <Pause className="size-3.5 text-warning" />
              )}
              <span className="hidden lg:inline">
                {isPaused ? "Resume" : "Pause"}
              </span>
            </Button>

            <div className="flex items-center gap-1 rounded-2xl border border-border/30 p-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                disabled={filteredLogs.length === 0}
                className="h-7 gap-1.5 px-2 text-xs"
                aria-label="Copy logs to clipboard"
                title="Copy logs"
              >
                <Copy className="size-3.5 text-muted-foreground" />
                <span className="hidden xl:inline">Copy</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleDownload}
                disabled={filteredLogs.length === 0}
                className="h-7 gap-1.5 px-2 text-xs"
                aria-label="Download logs as text file"
                title="Download logs"
              >
                <Download className="size-3.5 text-muted-foreground" />
                <span className="hidden xl:inline">Download</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Tier 2: filters and display prefs — secondary, visually grouped, wraps independently */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-border/30 border-t pt-1.5">
          {/* Filter cluster */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Select
              value={String(linesLimit)}
              onValueChange={(val) => val && setLinesLimit(Number(val))}
            >
              <SelectTrigger className="h-7 gap-1.5 border-border/40 bg-transparent px-2.5 font-normal text-xs shadow-none">
                <Hash className="size-3.5 text-muted-foreground" />
                <span>
                  <span className="hidden sm:inline">Limit: </span>
                  {linesLimit}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="100" className="text-xs">
                  100 lines
                </SelectItem>
                <SelectItem value="300" className="text-xs">
                  300 lines
                </SelectItem>
                <SelectItem value="500" className="text-xs">
                  500 lines
                </SelectItem>
                <SelectItem value="1000" className="text-xs">
                  1000 lines
                </SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={timeRange}
              onValueChange={(val) => val && setTimeRange(val)}
            >
              <SelectTrigger className="h-7 gap-1.5 border-border/40 bg-transparent px-2.5 font-normal text-xs shadow-none">
                <Clock className="size-3.5 text-muted-foreground" />
                <span>
                  <span className="hidden md:inline">Range: </span>
                  {timeRange === "all"
                    ? "All time"
                    : timeRange === "1h"
                      ? "Last 1h"
                      : `Last ${timeRange}`}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  All time
                </SelectItem>
                <SelectItem value="1h" className="text-xs">
                  Last hour
                </SelectItem>
                <SelectItem value="6h" className="text-xs">
                  Last 6 hours
                </SelectItem>
                <SelectItem value="24h" className="text-xs">
                  Last 24 hours
                </SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={
                typeFilters.length === 1
                  ? typeFilters[0]
                  : typeFilters.length === 0
                    ? "all"
                    : "multiple"
              }
              onValueChange={(val) => {
                if (!val) return;
                if (val === "all") setTypeFilters([]);
                else setTypeFilters([val]);
              }}
            >
              <SelectTrigger className="h-7 gap-1.5 border-border/40 bg-transparent px-2.5 font-normal text-xs shadow-none">
                <Filter className="size-3.5 text-muted-foreground" />
                <span>
                  <span className="hidden md:inline">Level: </span>
                  {typeFilters.length === 0
                    ? "All"
                    : typeFilters.length === 1
                      ? typeFilters[0].toUpperCase()
                      : `(${typeFilters.length})`}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  All Levels
                </SelectItem>
                <SelectItem value="error" className="text-xs">
                  Error ({levelCounts.error})
                </SelectItem>
                <SelectItem value="warning" className="text-xs">
                  Warning ({levelCounts.warning})
                </SelectItem>
                <SelectItem value="success" className="text-xs">
                  Success ({levelCounts.success})
                </SelectItem>
                <SelectItem value="info" className="text-xs">
                  Info ({levelCounts.info})
                </SelectItem>
                <SelectItem value="debug" className="text-xs">
                  Debug ({levelCounts.debug})
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Divider — only shows on wide-enough screens to avoid an orphaned rule */}
          <div className="hidden h-4 w-px bg-border/40 sm:block" />

          {/* Display-preference cluster */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Select
              value={fontSize}
              onValueChange={(val) =>
                val && setFontSize(val as "sm" | "md" | "lg")
              }
            >
              <SelectTrigger className="h-7 gap-1.5 border-border/40 bg-transparent px-2.5 font-normal text-xs shadow-none">
                <span className="font-mono font-semibold text-muted-foreground">
                  aA
                </span>
                <span className="hidden capitalize lg:inline">
                  {fontSize === "sm"
                    ? "Small"
                    : fontSize === "md"
                      ? "Medium"
                      : "Large"}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sm" className="text-xs">
                  Small
                </SelectItem>
                <SelectItem value="md" className="text-xs">
                  Medium
                </SelectItem>
                <SelectItem value="lg" className="text-xs">
                  Large
                </SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant={showTimestamp ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowTimestamp(!showTimestamp)}
              className="h-7 gap-1 border-border/30 px-2 text-xs"
              title="Toggle Timestamps"
            >
              <Clock className="size-3 text-muted-foreground" />
              <span className="hidden xl:inline">Time</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Paused alert panel */}
      {isPaused && (
        <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-warning text-xs">
          <Pause className="size-3.5 animate-pulse" />
          <span>
            Streaming is paused.{" "}
            {messageBuffer.length > 0
              ? `(${messageBuffer.length} messages buffered)`
              : "No new messages"}
          </span>
        </div>
      )}

      {/* Terminal log panel */}
      <div className="relative">
        <CodeSurface>
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className={cn(
              "custom-logs-scrollbar space-y-0.5 overflow-y-auto bg-muted/30 p-2 font-mono transition-all sm:p-3",
              maxHeightClass,
              fontSize === "sm"
                ? "text-[10px]"
                : fontSize === "md"
                  ? "text-xs"
                  : "text-sm",
            )}
          >
            {filteredLogs.length > 0 ? (
              filteredLogs.map((logItem) => (
                <TerminalLine
                  key={logItem.id}
                  log={logItem}
                  noTimestamp={!showTimestamp}
                  searchTerm={searchQuery}
                  fontSize={fontSize}
                />
              ))
            ) : (
              <div className="flex h-full min-h-[160px] items-center justify-center py-8 font-sans text-muted-foreground text-xs">
                {emptyMessage}
              </div>
            )}
          </div>
        </CodeSurface>

        {/* Floating Snap to Bottom button */}
        {showScrollBottomBtn && (
          <Button
            size="sm"
            onClick={snapToBottom}
            className="fade-in slide-in-from-bottom-2 absolute right-4 bottom-4 h-8 animate-in gap-1 rounded-full bg-primary/95 text-primary-foreground text-xs shadow-lg duration-200 hover:bg-primary/90"
            aria-label="Snap view to bottom"
          >
            <ArrowDown className="size-3.5 animate-bounce" />
            <span>Scroll to Bottom</span>
            {unseenCount > 0 && (
              <Badge
                variant="secondary"
                className="h-4.5 rounded-full bg-secondary-foreground px-1 font-bold text-[9px] text-secondary tabular-nums"
              >
                +{unseenCount}
              </Badge>
            )}
          </Button>
        )}
      </div>
    </div>
  );
};
