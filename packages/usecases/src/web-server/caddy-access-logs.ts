import { z } from "zod";

export const AccessLogStatusGroupSchema = z.enum([
  "all",
  "1xx",
  "2xx",
  "3xx",
  "4xx",
  "5xx",
]);

export const ACCESS_LOG_RANGE_ERROR = "Choose a date range of 31 days or less.";
const MAX_ACCESS_LOG_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

/**
 * Keep the date range bounded because the request chart emits one data point
 * per hour, even when the underlying Caddy log read is capped.
 */
export const AccessLogRangeFieldsSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export const AccessLogQueryFieldsSchema = AccessLogRangeFieldsSchema.extend({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(100).default(25),
  sortBy: z
    .enum(["timestamp", "status", "duration", "host", "method"])
    .default("timestamp"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  statusGroup: AccessLogStatusGroupSchema.default("all"),
});

export function isValidAccessLogRange(input: {
  from: Date;
  to: Date;
}): boolean {
  const rangeMs = input.to.getTime() - input.from.getTime();
  return rangeMs >= 0 && rangeMs <= MAX_ACCESS_LOG_RANGE_MS;
}

function assertValidAccessLogRange(from: Date, to: Date): void {
  if (!isValidAccessLogRange({ from, to })) {
    throw new RangeError(ACCESS_LOG_RANGE_ERROR);
  }
}

export const AccessLogRangeSchema = AccessLogRangeFieldsSchema.refine(
  isValidAccessLogRange,
  {
    message: ACCESS_LOG_RANGE_ERROR,
    path: ["to"],
  },
);

export const AccessLogQuerySchema = AccessLogQueryFieldsSchema.refine(
  isValidAccessLogRange,
  {
    message: ACCESS_LOG_RANGE_ERROR,
    path: ["to"],
  },
);

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

export type AccessLogTrafficSummary = {
  requestCount: number;
  averageDurationMs: number;
  totalBytes: number;
  errorRequestCount: number;
  topRoutes: {
    host: string;
    path: string;
    requestCount: number;
    averageDurationMs: number;
    totalBytes: number;
  }[];
};

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
  assertValidAccessLogRange(query.from, query.to);
  const from = query.from.getTime();
  const to = query.to.getTime();
  const rangedEntries = parseAccessLogEntries(content).filter((entry) => {
    const time = Date.parse(entry.timestamp);
    return time >= from && time <= to;
  });
  return queryAccessLogEntriesFromEntries(rangedEntries, query);
}

export function queryAccessLogDashboard(
  content: string,
  query: AccessLogQuery,
) {
  assertValidAccessLogRange(query.from, query.to);
  const from = query.from.getTime();
  const to = query.to.getTime();
  const rangedEntries = parseAccessLogEntries(content).filter((entry) => {
    const time = Date.parse(entry.timestamp);
    return time >= from && time <= to;
  });

  return {
    ...queryAccessLogEntriesFromEntries(rangedEntries, query),
    stats: aggregateAccessLogStatsFromEntries(
      rangedEntries,
      query.from,
      query.to,
    ),
    summary: summarizeAccessLogTraffic(rangedEntries),
  };
}

function queryAccessLogEntriesFromEntries(
  entries: AccessLogEntry[],
  query: AccessLogQuery,
) {
  const filtered = entries.filter((entry) =>
    inStatusGroup(entry.status, query.statusGroup),
  );
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
  assertValidAccessLogRange(from, to);
  const startTime = from.getTime();
  const endTime = to.getTime();
  const rangedEntries = parseAccessLogEntries(content).filter((entry) => {
    const time = Date.parse(entry.timestamp);
    return time >= startTime && time <= endTime;
  });
  return aggregateAccessLogStatsFromEntries(rangedEntries, from, to);
}

function aggregateAccessLogStatsFromEntries(
  entries: AccessLogEntry[],
  from: Date,
  to: Date,
): AccessLogStatsPoint[] {
  const counts = new Map<number, number>();
  for (const entry of entries) {
    const time = Date.parse(entry.timestamp);
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

function summarizeAccessLogTraffic(
  entries: AccessLogEntry[],
): AccessLogTrafficSummary {
  const routes = new Map<
    string,
    {
      host: string;
      path: string;
      requestCount: number;
      durationTotal: number;
      totalBytes: number;
    }
  >();
  let totalDuration = 0;
  let totalBytes = 0;
  let errorRequestCount = 0;

  for (const entry of entries) {
    const path = normalizeRequestPath(entry.uri);
    const key = `${entry.host}\u0000${path}`;
    const route = routes.get(key) ?? {
      host: entry.host,
      path,
      requestCount: 0,
      durationTotal: 0,
      totalBytes: 0,
    };
    route.requestCount += 1;
    route.durationTotal += entry.durationMs;
    route.totalBytes += Math.max(0, entry.size);
    routes.set(key, route);

    totalDuration += entry.durationMs;
    totalBytes += Math.max(0, entry.size);
    if (entry.status >= 400) errorRequestCount += 1;
  }

  const topRoutes = [...routes.values()]
    .sort(
      (left, right) =>
        right.requestCount - left.requestCount ||
        left.host.localeCompare(right.host) ||
        left.path.localeCompare(right.path),
    )
    .slice(0, 10)
    .map(({ durationTotal, ...route }) => ({
      ...route,
      averageDurationMs:
        Math.round((durationTotal / route.requestCount) * 100) / 100,
    }));

  return {
    requestCount: entries.length,
    averageDurationMs:
      entries.length > 0
        ? Math.round((totalDuration / entries.length) * 100) / 100
        : 0,
    totalBytes,
    errorRequestCount,
    topRoutes,
  };
}

function normalizeRequestPath(uri: string): string {
  try {
    return new URL(uri, "http://upstand.invalid").pathname || "/";
  } catch {
    return uri.split("?", 1)[0] || "/";
  }
}
