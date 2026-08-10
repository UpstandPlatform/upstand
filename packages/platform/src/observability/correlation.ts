import { randomUUID } from "node:crypto";

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Accepts only bounded, log-safe correlation identifiers from trust boundaries. */
export function normalizeCorrelationId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return CORRELATION_ID_PATTERN.test(normalized) ? normalized : undefined;
}

/** Preserves a valid upstream identifier or creates a new operation identifier. */
export function resolveCorrelationId(value?: unknown): string {
  return normalizeCorrelationId(value) ?? randomUUID();
}
