type CounterKey = `${string}:${number}`;

const startedAt = Date.now();
const requestCounters = new Map<CounterKey, number>();
const authenticationCounters = new Map<"authenticated" | "rejected", number>();
let requestCount = 0;
let requestDurationSeconds = 0;

export function recordServerRequest(
  method: string,
  status: number,
  durationMs: number,
): void {
  const key: CounterKey = `${method.toUpperCase()}:${status}`;
  requestCounters.set(key, (requestCounters.get(key) ?? 0) + 1);
  requestCount += 1;
  requestDurationSeconds += Math.max(0, durationMs) / 1_000;
}

/** Records only the authentication outcome; never attach user or token data. */
export function recordAuthenticationAttempt(authenticated: boolean): void {
  const outcome = authenticated ? "authenticated" : "rejected";
  authenticationCounters.set(
    outcome,
    (authenticationCounters.get(outcome) ?? 0) + 1,
  );
}

export function renderServerMetrics(now = Date.now()): string {
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
  return lines.join("\n");
}

function escapeLabel(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n");
}
