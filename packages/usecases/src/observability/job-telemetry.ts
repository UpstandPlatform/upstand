import { resolveCorrelationId } from "@upstand/platform";
import { createRequestLogger } from "evlog";

export type JobTelemetryInput = {
  operation: string;
  queue: string;
  jobId?: string | number | null;
  correlationId?: unknown;
  attempt?: number;
  fields?: Record<string, unknown>;
};

export type JobTelemetryOutcome = "success" | "failure";

export type JobTelemetryMetric = {
  operation: string;
  outcome: JobTelemetryOutcome;
  count: number;
  durationSeconds: number;
};

const jobMetrics = new Map<string, JobTelemetryMetric>();
const JOB_OPERATION_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;

/** Returns bounded, process-local metrics for background-job lifecycle health. */
export function getJobTelemetryMetrics(): JobTelemetryMetric[] {
  return [...jobMetrics.values()]
    .map((metric) => ({ ...metric }))
    .sort((left, right) =>
      `${left.operation}:${left.outcome}`.localeCompare(
        `${right.operation}:${right.outcome}`,
      ),
    );
}

/** Emits one redacted wide event for a complete background-job execution. */
export async function withJobTelemetry<T>(
  input: JobTelemetryInput,
  work: (correlationId: string) => Promise<T>,
): Promise<T> {
  const operation = normalizeOperation(input.operation);
  const startedAt = Date.now();
  const correlationId = resolveCorrelationId(
    input.correlationId ?? input.jobId?.toString(),
  );
  const jobLog = createRequestLogger({ requestId: correlationId });
  jobLog.set({
    correlationId,
    operation,
    queue: input.queue,
    job: {
      id: input.jobId?.toString(),
      attempt: input.attempt,
    },
    ...input.fields,
  });
  let outcome: JobTelemetryOutcome = "success";
  try {
    const result = await work(correlationId);
    jobLog.set({ outcome: "success" });
    return result;
  } catch (error) {
    outcome = "failure";
    jobLog.error(error instanceof Error ? error : String(error), {
      outcome: "failure",
    });
    throw error;
  } finally {
    recordJobMetric(operation, outcome, (Date.now() - startedAt) / 1_000);
    jobLog.emit({ _forceKeep: true });
  }
}

function normalizeOperation(operation: string): string {
  const normalized = operation.trim().toLowerCase();
  return JOB_OPERATION_PATTERN.test(normalized) ? normalized : "other";
}

function recordJobMetric(
  operation: string,
  outcome: JobTelemetryOutcome,
  durationSeconds: number,
): void {
  const key = `${operation}:${outcome}`;
  const previous = jobMetrics.get(key);
  jobMetrics.set(key, {
    operation,
    outcome,
    count: (previous?.count ?? 0) + 1,
    durationSeconds:
      (previous?.durationSeconds ?? 0) + Math.max(0, durationSeconds),
  });
}
