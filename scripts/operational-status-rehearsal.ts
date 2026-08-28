type JsonRecord = Record<string, unknown>;

export type OperationalThresholds = {
  maxWaitingCount: number;
  maxFailedCount: number;
  maxDeadLetterCount: number;
  maxOutboxPendingCount: number;
  maxOutboxPublishingCount: number;
  maxBackupAgeSeconds: number;
  requireBackupSuccess: boolean;
  requireBackupRestoreVerification: boolean;
  requestTimeoutMs: number;
};

export type EndpointSnapshot = {
  status: number;
  body: unknown;
};

export type OperationalStatusSnapshot = {
  controlPlane: EndpointSnapshot;
  schedulesReady: EndpointSnapshot;
  schedulesStatus: EndpointSnapshot;
};

export type OperationalCheckResult = {
  passed: boolean;
  violations: string[];
  summary: JsonRecord;
};

const DEFAULTS: OperationalThresholds = {
  maxWaitingCount: 1_000,
  maxFailedCount: 0,
  maxDeadLetterCount: 0,
  maxOutboxPendingCount: 1_000,
  maxOutboxPublishingCount: 100,
  maxBackupAgeSeconds: 0,
  requireBackupSuccess: false,
  requireBackupRestoreVerification: false,
  requestTimeoutMs: 5_000,
};

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as JsonRecord;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function parseNonNegativeInteger(
  source: Record<string, string | undefined>,
  name: string,
  fallback: number,
  maximum = 1_000_000,
): number {
  const raw = source[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > maximum) {
    throw new Error(`${name} must be between 0 and ${maximum}`);
  }
  return value;
}

export function parseOperationalThresholds(
  source: Record<string, string | undefined> = process.env,
): OperationalThresholds {
  const requireBackupSuccess = source.OPERATIONAL_STATUS_REQUIRE_BACKUP_SUCCESS;
  if (
    requireBackupSuccess !== undefined &&
    requireBackupSuccess !== "true" &&
    requireBackupSuccess !== "false"
  ) {
    throw new Error(
      "OPERATIONAL_STATUS_REQUIRE_BACKUP_SUCCESS must be true or false",
    );
  }
  const requireBackupRestoreVerification =
    source.OPERATIONAL_STATUS_REQUIRE_BACKUP_RESTORE_VERIFICATION;
  if (
    requireBackupRestoreVerification !== undefined &&
    requireBackupRestoreVerification !== "true" &&
    requireBackupRestoreVerification !== "false"
  ) {
    throw new Error(
      "OPERATIONAL_STATUS_REQUIRE_BACKUP_RESTORE_VERIFICATION must be true or false",
    );
  }

  return {
    maxWaitingCount: parseNonNegativeInteger(
      source,
      "OPERATIONAL_STATUS_MAX_WAITING_COUNT",
      DEFAULTS.maxWaitingCount,
    ),
    maxFailedCount: parseNonNegativeInteger(
      source,
      "OPERATIONAL_STATUS_MAX_FAILED_COUNT",
      DEFAULTS.maxFailedCount,
    ),
    maxDeadLetterCount: parseNonNegativeInteger(
      source,
      "OPERATIONAL_STATUS_MAX_DEAD_LETTER_COUNT",
      DEFAULTS.maxDeadLetterCount,
    ),
    maxOutboxPendingCount: parseNonNegativeInteger(
      source,
      "OPERATIONAL_STATUS_MAX_OUTBOX_PENDING_COUNT",
      DEFAULTS.maxOutboxPendingCount,
    ),
    maxOutboxPublishingCount: parseNonNegativeInteger(
      source,
      "OPERATIONAL_STATUS_MAX_OUTBOX_PUBLISHING_COUNT",
      DEFAULTS.maxOutboxPublishingCount,
    ),
    maxBackupAgeSeconds: parseNonNegativeInteger(
      source,
      "OPERATIONAL_STATUS_MAX_BACKUP_AGE_SECONDS",
      DEFAULTS.maxBackupAgeSeconds,
      604_800,
    ),
    requireBackupSuccess: requireBackupSuccess === "true",
    requireBackupRestoreVerification:
      requireBackupRestoreVerification === "true",
    requestTimeoutMs: parseNonNegativeInteger(
      source,
      "OPERATIONAL_STATUS_REQUEST_TIMEOUT_MS",
      DEFAULTS.requestTimeoutMs,
      60_000,
    ),
  };
}

function queueSummary(value: unknown, index: number): JsonRecord {
  const queue = asRecord(value, `schedules.queues[${index}]`);
  return {
    name: String(queue.name ?? `queue-${index}`),
    waitingCount: asNumber(queue.waitingCount, `queue ${index} waitingCount`),
    failedCount: asNumber(queue.failedCount, `queue ${index} failedCount`),
    delayedCount: asNumber(queue.delayedCount, `queue ${index} delayedCount`),
    isHealthy: queue.isHealthy === true,
  };
}

export function evaluateOperationalStatus(
  snapshot: OperationalStatusSnapshot,
  thresholds: OperationalThresholds,
  nowMs = Date.now(),
): OperationalCheckResult {
  const violations: string[] = [];
  const controlPlane = asRecord(
    snapshot.controlPlane.body,
    "control-plane readiness",
  );
  const schedulesReady = asRecord(
    snapshot.schedulesReady.body,
    "schedules readiness",
  );
  const schedulesStatus = asRecord(
    snapshot.schedulesStatus.body,
    "schedules status",
  );

  if (snapshot.controlPlane.status !== 200 || controlPlane.status !== "ready") {
    violations.push("control-plane readiness is not ready");
  }
  if (
    snapshot.schedulesReady.status !== 200 ||
    schedulesReady.status !== "ok"
  ) {
    violations.push("schedules readiness is not ready");
  }
  if (snapshot.schedulesStatus.status !== 200) {
    violations.push("schedules status endpoint did not return HTTP 200");
  }
  if (schedulesStatus.status !== "running") {
    violations.push("schedules service is not running");
  }
  if (schedulesStatus.redis !== true)
    violations.push("schedules Redis is not ready");
  if (schedulesStatus.workersReady !== true) {
    violations.push("schedules workers are not ready");
  }

  const queues = Array.isArray(schedulesStatus.queues)
    ? schedulesStatus.queues.map(queueSummary)
    : [];
  if (queues.length === 0)
    violations.push("schedules queue status is unavailable");
  for (const queue of queues) {
    const name = String(queue.name);
    if (queue.isHealthy !== true) violations.push(`queue ${name} is unhealthy`);
    if (Number(queue.waitingCount) > thresholds.maxWaitingCount) {
      violations.push(
        `queue ${name} waiting count ${queue.waitingCount} exceeds ${thresholds.maxWaitingCount}`,
      );
    }
    if (Number(queue.failedCount) > thresholds.maxFailedCount) {
      violations.push(
        `queue ${name} failed count ${queue.failedCount} exceeds ${thresholds.maxFailedCount}`,
      );
    }
  }

  const outbox = schedulesStatus.outbox
    ? asRecord(schedulesStatus.outbox, "schedules outbox")
    : null;
  if (!outbox) {
    violations.push("outbox operational summary is unavailable");
  } else {
    const pending = asNumber(outbox.pending, "outbox pending");
    const publishing = asNumber(outbox.publishing, "outbox publishing");
    const deadLetter = asNumber(outbox.deadLetter, "outbox deadLetter");
    if (pending > thresholds.maxOutboxPendingCount) {
      violations.push(
        `outbox pending count ${pending} exceeds ${thresholds.maxOutboxPendingCount}`,
      );
    }
    if (publishing > thresholds.maxOutboxPublishingCount) {
      violations.push(
        `outbox publishing count ${publishing} exceeds ${thresholds.maxOutboxPublishingCount}`,
      );
    }
    if (deadLetter > thresholds.maxDeadLetterCount) {
      violations.push(
        `outbox dead-letter count ${deadLetter} exceeds ${thresholds.maxDeadLetterCount}`,
      );
    }
  }

  const backup = schedulesStatus.backup
    ? asRecord(schedulesStatus.backup, "schedules backup")
    : null;
  if (!backup) {
    violations.push("backup operational summary is unavailable");
  } else {
    const succeededAt = backup.lastSucceededAt;
    const failedAt = backup.lastFailedAt;
    const succeededMs = succeededAt
      ? Date.parse(String(succeededAt))
      : Number.NaN;
    const failedMs = failedAt ? Date.parse(String(failedAt)) : Number.NaN;
    if (succeededAt && !Number.isFinite(succeededMs)) {
      violations.push("backup lastSucceededAt is invalid");
    }
    if (failedAt && !Number.isFinite(failedMs)) {
      violations.push("backup lastFailedAt is invalid");
    }
    if (
      Number.isFinite(failedMs) &&
      (!Number.isFinite(succeededMs) || failedMs > succeededMs)
    ) {
      violations.push("the most recent backup run failed");
    }
    if (thresholds.requireBackupSuccess && !Number.isFinite(succeededMs)) {
      violations.push("no successful backup has been recorded");
    }
    const restoreTestedAt = backup.lastSucceededRestoreTestedAt;
    const restoreTestedMs = restoreTestedAt
      ? Date.parse(String(restoreTestedAt))
      : Number.NaN;
    if (restoreTestedAt && !Number.isFinite(restoreTestedMs)) {
      violations.push("backup lastSucceededRestoreTestedAt is invalid");
    }
    if (
      thresholds.requireBackupRestoreVerification &&
      (!Number.isFinite(restoreTestedMs) ||
        (Number.isFinite(succeededMs) && restoreTestedMs < succeededMs))
    ) {
      violations.push(
        "the most recent successful backup has no subsequent restore verification",
      );
    }
    if (
      thresholds.maxBackupAgeSeconds > 0 &&
      Number.isFinite(succeededMs) &&
      nowMs - succeededMs > thresholds.maxBackupAgeSeconds * 1_000
    ) {
      violations.push(
        `last successful backup is older than ${thresholds.maxBackupAgeSeconds} seconds`,
      );
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    summary: {
      controlPlane: {
        httpStatus: snapshot.controlPlane.status,
        status: controlPlane.status,
      },
      schedulesReady: {
        httpStatus: snapshot.schedulesReady.status,
        status: schedulesReady.status,
      },
      schedules: {
        httpStatus: snapshot.schedulesStatus.status,
        status: schedulesStatus.status,
        redis: schedulesStatus.redis === true,
        workersReady: schedulesStatus.workersReady === true,
        queues,
        outbox,
        backup,
      },
      thresholds,
    },
  };
}

async function fetchJsonEndpoint(
  url: string,
  headers: HeadersInit,
  timeoutMs: number,
): Promise<EndpointSnapshot> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(Math.max(100, timeoutMs)),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function parseAuthHeader(value: string | undefined): HeadersInit {
  if (!value) return {};
  const separator = value.indexOf(":");
  if (separator <= 0) {
    throw new Error(
      "OPERATIONAL_STATUS_AUTH_HEADER must use 'Name: value' format",
    );
  }
  return {
    [value.slice(0, separator).trim()]: value.slice(separator + 1).trim(),
  };
}

export async function runOperationalStatusRehearsal(
  controlPlaneUrl: string,
  schedulesUrl: string,
  thresholds = parseOperationalThresholds(),
  authHeader = process.env.OPERATIONAL_STATUS_AUTH_HEADER,
): Promise<OperationalCheckResult> {
  const headers = parseAuthHeader(authHeader);
  const controlBase = controlPlaneUrl.replace(/\/$/, "");
  const schedulesBase = schedulesUrl.replace(/\/$/, "");
  const [controlPlane, schedulesReady, schedulesStatus] = await Promise.all([
    fetchJsonEndpoint(
      `${controlBase}/health/ready`,
      headers,
      thresholds.requestTimeoutMs,
    ),
    fetchJsonEndpoint(
      `${schedulesBase}/health/ready`,
      headers,
      thresholds.requestTimeoutMs,
    ),
    fetchJsonEndpoint(
      `${schedulesBase}/status`,
      headers,
      thresholds.requestTimeoutMs,
    ),
  ]);
  return evaluateOperationalStatus(
    { controlPlane, schedulesReady, schedulesStatus },
    thresholds,
  );
}

async function main(): Promise<void> {
  const [controlPlaneUrl, schedulesUrl] = Bun.argv.slice(2);
  if (!controlPlaneUrl || !schedulesUrl) {
    throw new Error(
      "usage: operational-status-rehearsal.ts CONTROL_PLANE_URL SCHEDULES_URL",
    );
  }
  const result = await runOperationalStatusRehearsal(
    controlPlaneUrl,
    schedulesUrl,
  );
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(
      `operational-status-rehearsal: ${error instanceof Error ? error.message : "check failed"}`,
    );
    process.exitCode = 1;
  });
}
