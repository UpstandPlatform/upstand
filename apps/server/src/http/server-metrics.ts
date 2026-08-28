import { renderUpGalBudgetMetrics } from "@upstand/api/ai-budget";

type CounterKey = `${string}:${number}`;
export type ServerRouteGroup =
  | "api"
  | "auth"
  | "deployments"
  | "mcp"
  | "system"
  | "webhooks"
  | "other";
type RouteCounterKey = `${ServerRouteGroup}:${string}:${number}`;
export type WebhookProvider =
  | "github"
  | "gitlab"
  | "gitea"
  | "bitbucket"
  | "dockerhub"
  | "deployment";
type WebhookCounterKey = `${WebhookProvider}:${number}`;

const startedAt = Date.now();
const requestCounters = new Map<CounterKey, number>();
const routeRequestCounters = new Map<RouteCounterKey, number>();
const routeDurationCounts = new Map<ServerRouteGroup, number[]>();
const routeDurationSums = new Map<ServerRouteGroup, number>();
const routeDurationRequests = new Map<ServerRouteGroup, number>();
const authenticationCounters = new Map<"authenticated" | "rejected", number>();
const webhookCounters = new Map<WebhookCounterKey, number>();
let requestCount = 0;
let requestDurationSeconds = 0;
let webhookRequestDurationSeconds = 0;

const ROUTE_LATENCY_BUCKETS_MS = [100, 500, 1_000, 2_000, 5_000, 10_000];
const HTTP_METHODS = new Set([
  "CONNECT",
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "TRACE",
]);

export type DatabasePoolMetrics = {
  total: number;
  idle: number;
  waiting: number;
};

export function recordServerRequest(
  method: string,
  status: number,
  durationMs: number,
  path = "/",
): void {
  const normalizedMethod = normalizeHttpMethod(method);
  const normalizedStatus = normalizeHttpStatus(status);
  const normalizedDurationMs = normalizeDurationMs(durationMs);
  const key: CounterKey = `${normalizedMethod}:${normalizedStatus}`;
  requestCounters.set(key, (requestCounters.get(key) ?? 0) + 1);
  requestCount += 1;
  requestDurationSeconds += normalizedDurationMs / 1_000;

  const routeGroup = classifyServerRoute(path);
  const routeKey: RouteCounterKey = `${routeGroup}:${normalizedMethod}:${normalizedStatus}`;
  routeRequestCounters.set(
    routeKey,
    (routeRequestCounters.get(routeKey) ?? 0) + 1,
  );
  const bucketCounts =
    routeDurationCounts.get(routeGroup) ??
    Array.from({ length: ROUTE_LATENCY_BUCKETS_MS.length }, () => 0);
  for (const [index, boundaryMs] of ROUTE_LATENCY_BUCKETS_MS.entries()) {
    if (normalizedDurationMs <= boundaryMs) {
      bucketCounts[index] = (bucketCounts[index] ?? 0) + 1;
    }
  }
  routeDurationCounts.set(routeGroup, bucketCounts);
  routeDurationSums.set(
    routeGroup,
    (routeDurationSums.get(routeGroup) ?? 0) + normalizedDurationMs / 1_000,
  );
  routeDurationRequests.set(
    routeGroup,
    (routeDurationRequests.get(routeGroup) ?? 0) + 1,
  );
}

/** Records only the authentication outcome; never attach user or token data. */
export function recordAuthenticationAttempt(authenticated: boolean): void {
  const outcome = authenticated ? "authenticated" : "rejected";
  authenticationCounters.set(
    outcome,
    (authenticationCounters.get(outcome) ?? 0) + 1,
  );
}

/** Records only low-cardinality webhook outcome and latency data. */
export function recordWebhookRequest(
  provider: WebhookProvider,
  status: number,
  durationMs: number,
): void {
  const normalizedStatus = Number.isInteger(status)
    ? Math.min(599, Math.max(100, status))
    : 500;
  const normalizedDurationMs =
    Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
  const key: WebhookCounterKey = `${provider}:${normalizedStatus}`;
  webhookCounters.set(key, (webhookCounters.get(key) ?? 0) + 1);
  webhookRequestDurationSeconds += normalizedDurationMs / 1_000;
}

export function renderServerMetrics(
  now = Date.now(),
  databasePool?: DatabasePoolMetrics,
): string {
  const lines = [
    "# HELP upstand_server_requests_total Total HTTP requests handled by the API process.",
    "# TYPE upstand_server_requests_total counter",
  ];
  for (const [key, count] of [...requestCounters.entries()].sort()) {
    const separator = key.lastIndexOf(":");
    const method = key.slice(0, separator);
    const status = key.slice(separator + 1);
    lines.push(
      `upstand_server_requests_total{method="${escapeLabel(method)}",status="${escapeLabel(status)}"} ${count}`,
    );
  }
  lines.push(
    "# HELP upstand_server_route_requests_total HTTP requests by bounded route family, method, and status.",
    "# TYPE upstand_server_route_requests_total counter",
  );
  for (const [key, count] of [...routeRequestCounters.entries()].sort()) {
    const [routeGroup = "other", method = "OTHER", status = "500"] =
      key.split(":");
    lines.push(
      `upstand_server_route_requests_total{route_group="${escapeLabel(routeGroup)}",method="${escapeLabel(method)}",status="${escapeLabel(status)}"} ${count}`,
    );
  }
  lines.push(
    "# HELP upstand_server_route_request_duration_seconds Request latency by bounded route family.",
    "# TYPE upstand_server_route_request_duration_seconds histogram",
  );
  for (const routeGroup of [...routeDurationRequests.keys()].sort()) {
    const bucketCounts = routeDurationCounts.get(routeGroup) ?? [];
    for (const [index, boundaryMs] of ROUTE_LATENCY_BUCKETS_MS.entries()) {
      lines.push(
        `upstand_server_route_request_duration_seconds_bucket{route_group="${escapeLabel(routeGroup)}",le="${boundaryMs / 1_000}"} ${bucketCounts[index] ?? 0}`,
      );
    }
    lines.push(
      `upstand_server_route_request_duration_seconds_bucket{route_group="${escapeLabel(routeGroup)}",le="+Inf"} ${routeDurationRequests.get(routeGroup) ?? 0}`,
      `upstand_server_route_request_duration_seconds_sum{route_group="${escapeLabel(routeGroup)}"} ${routeDurationSums.get(routeGroup) ?? 0}`,
      `upstand_server_route_request_duration_seconds_count{route_group="${escapeLabel(routeGroup)}"} ${routeDurationRequests.get(routeGroup) ?? 0}`,
    );
  }
  lines.push(
    "# HELP upstand_server_request_duration_seconds_total Total HTTP request duration in seconds.",
    "# TYPE upstand_server_request_duration_seconds_total counter",
    `upstand_server_request_duration_seconds_total ${requestDurationSeconds}`,
    "# HELP upstand_server_request_count_total Total HTTP requests handled by the API process.",
    "# TYPE upstand_server_request_count_total counter",
    `upstand_server_request_count_total ${requestCount}`,
    "# HELP upstand_server_uptime_seconds API process uptime in seconds.",
    "# TYPE upstand_server_uptime_seconds gauge",
    `upstand_server_uptime_seconds ${Math.max(0, Math.floor((now - startedAt) / 1_000))}`,
    "# HELP upstand_server_process_resident_memory_bytes Resident memory used by the API process.",
    "# TYPE upstand_server_process_resident_memory_bytes gauge",
    `upstand_server_process_resident_memory_bytes ${process.memoryUsage().rss}`,
    "",
  );
  lines.splice(
    lines.length - 1,
    0,
    "# HELP upstand_server_authentication_attempts_total Authentication outcomes observed by the protected HTTP middleware.",
    "# TYPE upstand_server_authentication_attempts_total counter",
    ...(["authenticated", "rejected"] as const).map(
      (outcome) =>
        `upstand_server_authentication_attempts_total{outcome="${outcome}"} ${authenticationCounters.get(outcome) ?? 0}`,
    ),
  );
  lines.splice(
    lines.length - 1,
    0,
    "# HELP upstand_server_webhook_requests_total Webhook requests handled by provider and HTTP status.",
    "# TYPE upstand_server_webhook_requests_total counter",
    ...[...webhookCounters.entries()].sort().map(([key, count]) => {
      const separator = key.lastIndexOf(":");
      const provider = key.slice(0, separator);
      const status = key.slice(separator + 1);
      return `upstand_server_webhook_requests_total{provider="${escapeLabel(provider)}",status="${escapeLabel(status)}"} ${count}`;
    }),
    "# HELP upstand_server_webhook_request_duration_seconds_total Total webhook request duration in seconds.",
    "# TYPE upstand_server_webhook_request_duration_seconds_total counter",
    `upstand_server_webhook_request_duration_seconds_total ${webhookRequestDurationSeconds}`,
  );
  if (databasePool) {
    for (const value of [
      databasePool.total,
      databasePool.idle,
      databasePool.waiting,
    ]) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(
          "Database pool metrics must be finite and non-negative",
        );
      }
    }
    lines.splice(
      lines.length - 1,
      0,
      "# HELP upstand_server_database_pool_total PostgreSQL clients currently allocated to the API pool.",
      "# TYPE upstand_server_database_pool_total gauge",
      `upstand_server_database_pool_total ${Math.floor(databasePool.total)}`,
      "# HELP upstand_server_database_pool_idle PostgreSQL idle clients currently available to the API pool.",
      "# TYPE upstand_server_database_pool_idle gauge",
      `upstand_server_database_pool_idle ${Math.floor(databasePool.idle)}`,
      "# HELP upstand_server_database_pool_waiting Requests waiting for a PostgreSQL client in the API pool.",
      "# TYPE upstand_server_database_pool_waiting gauge",
      `upstand_server_database_pool_waiting ${Math.floor(databasePool.waiting)}`,
    );
  }
  lines.push(renderUpGalBudgetMetrics());
  return lines.join("\n");
}

function normalizeHttpMethod(method: string): string {
  const normalized = method.trim().toUpperCase();
  return HTTP_METHODS.has(normalized) ? normalized : "OTHER";
}

function normalizeHttpStatus(status: number): number {
  return Number.isInteger(status) ? Math.min(599, Math.max(100, status)) : 500;
}

function normalizeDurationMs(durationMs: number): number {
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
}

export function classifyServerRoute(path: string): ServerRouteGroup {
  const normalized = path.trim().toLowerCase();
  if (normalized === "/api/auth" || normalized.startsWith("/api/auth/")) {
    return "auth";
  }
  if (
    normalized === "/api/deploy" ||
    normalized.startsWith("/api/deploy/") ||
    normalized === "/api/resources" ||
    normalized.startsWith("/api/resources/")
  ) {
    return "deployments";
  }
  if (
    normalized === "/api/webhooks" ||
    normalized.startsWith("/api/webhooks/")
  ) {
    return "webhooks";
  }
  if (normalized === "/api/mcp" || normalized.startsWith("/api/mcp/")) {
    return "mcp";
  }
  if (
    normalized === "/_internal/metrics" ||
    normalized.startsWith("/health/")
  ) {
    return "system";
  }
  if (normalized === "/api" || normalized.startsWith("/api/")) {
    return "api";
  }
  return "other";
}

function escapeLabel(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n");
}
