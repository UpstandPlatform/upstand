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

/** Emits one redacted wide event for a complete background-job execution. */
export async function withJobTelemetry<T>(
  input: JobTelemetryInput,
  work: (correlationId: string) => Promise<T>,
): Promise<T> {
  const correlationId = resolveCorrelationId(
    input.correlationId ?? input.jobId?.toString(),
  );
  const jobLog = createRequestLogger({ requestId: correlationId });
  jobLog.set({
    correlationId,
    operation: input.operation,
    queue: input.queue,
    job: {
      id: input.jobId?.toString(),
      attempt: input.attempt,
    },
    ...input.fields,
  });
  try {
    const result = await work(correlationId);
    jobLog.set({ outcome: "success" });
    return result;
  } catch (error) {
    jobLog.error(error instanceof Error ? error : String(error), {
      outcome: "failure",
    });
    throw error;
  } finally {
    jobLog.emit({ _forceKeep: true });
  }
}
