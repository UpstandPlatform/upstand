import { z } from "zod";

export const AccessLogStatusGroupSchema = z.enum([
  "all",
  "1xx",
  "2xx",
  "3xx",
  "4xx",
  "5xx",
]);

export const AccessLogQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(100).default(25),
  sortBy: z
    .enum(["timestamp", "status", "duration", "host", "method"])
    .default("timestamp"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  statusGroup: AccessLogStatusGroupSchema.default("all"),
});

export type AccessLogQuery = z.infer<typeof AccessLogQuerySchema>;

export type AccessLogEntry = {
  id: string;
  timestamp: string;
  host: string;
  method: string;
  uri: string;
  status: number;
  durationMs: number;
  remoteIp: string;
  size: number;
  protocol: string;
  raw: Record<string, unknown>;
};

export type AccessLogStatsPoint = { timestamp: string; count: number };

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeEntry(
  raw: Record<string, unknown>,
  index: number,
): AccessLogEntry | null {
  const request =
    raw.request && typeof raw.request === "object"
      ? (raw.request as Record<string, unknown>)
      : {};
  const response =
    raw.response && typeof raw.response === "object"
      ? (raw.response as Record<string, unknown>)
      : {};
  const timestampValue = numberValue(raw.ts);
  const date =
    timestampValue > 0
      ? new Date(timestampValue * 1000)
      : new Date(stringValue(raw.timestamp));
  if (Number.isNaN(date.getTime())) return null;

  const remoteIp =
    stringValue(request.client_ip) ||
    stringValue(request.remote_ip).split(":")[0] ||
    "";
  const durationMs = numberValue(raw.duration) * 1000;
  const rawStatus =
    raw.status !== undefined && raw.status !== null
      ? numberValue(raw.status)
      : raw.status_code !== undefined
        ? numberValue(raw.status_code)
        : numberValue(response.status);

  // In Caddy access logs, status 0 for a "handled request" represents a successful 200 HTTP response.
  const status =
    rawStatus === 0 && stringValue(raw.msg) === "handled request"
      ? 200
      : Math.trunc(rawStatus);

  return {
    id: `${date.toISOString()}-${index}`,
    timestamp: date.toISOString(),
    host: stringValue(request.host),
    method: stringValue(request.method),
    uri: stringValue(request.uri),
    status,
    durationMs: Math.round(durationMs * 100) / 100,
    remoteIp,
    size: Math.trunc(numberValue(raw.size)),
    protocol: stringValue(request.proto),
    raw,
  };
}

export function parseAccessLogEntries(content: string): AccessLogEntry[] {
  return content.split("\n").flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      const raw = JSON.parse(line) as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const entry = normalizeEntry(raw as Record<string, unknown>, index);
      return entry ? [entry] : [];
    } catch {
      return [];
    }
  });
}

function inStatusGroup(
  status: number,
  group: AccessLogQuery["statusGroup"],
): boolean {
  return group === "all" || `${Math.floor(status / 100)}xx` === group;
}

export function queryAccessLogEntries(content: string, query: AccessLogQuery) {
  const from = query.from.getTime();
  const to = query.to.getTime();
  const filtered = parseAccessLogEntries(content).filter((entry) => {
    const time = Date.parse(entry.timestamp);
    return (
      time >= from &&
      time <= to &&
      inStatusGroup(entry.status, query.statusGroup)
    );
  });

  const direction = query.sortDirection === "asc" ? 1 : -1;
  filtered.sort((left, right) => {
    const values: Record<
      AccessLogQuery["sortBy"],
      [string | number, string | number]
    > = {
      timestamp: [Date.parse(left.timestamp), Date.parse(right.timestamp)],
      status: [left.status, right.status],
      duration: [left.durationMs, right.durationMs],
      host: [left.host, right.host],
      method: [left.method, right.method],
    };
    const [a, b] = values[query.sortBy];
    return (a < b ? -1 : a > b ? 1 : 0) * direction;
  });

  const total = filtered.length;
  const start = (query.page - 1) * query.pageSize;
  return {
    entries: filtered.slice(start, start + query.pageSize),
    total,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export function aggregateAccessLogStats(
  content: string,
  from: Date,
  to: Date,
): AccessLogStatsPoint[] {
  const counts = new Map<number, number>();
  for (const entry of parseAccessLogEntries(content)) {
    const time = Date.parse(entry.timestamp);
    if (time < from.getTime() || time > to.getTime()) continue;
    const hour = Math.floor(time / 3_600_000) * 3_600_000;
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }
  const start = Math.floor(from.getTime() / 3_600_000) * 3_600_000;
  const end = Math.floor(to.getTime() / 3_600_000) * 3_600_000;
  const points: AccessLogStatsPoint[] = [];
  for (let hour = start; hour <= end; hour += 3_600_000) {
    points.push({
      timestamp: new Date(hour).toISOString(),
      count: counts.get(hour) ?? 0,
    });
  }
  return points;
}
