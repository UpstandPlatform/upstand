import { describe, expect, test } from "bun:test";
import { normalizeCorrelationId, resolveCorrelationId } from "./correlation";

describe("correlation identifiers", () => {
  test("accepts bounded identifiers and rejects log injection", () => {
    expect(normalizeCorrelationId(" req-123:worker.1 ")).toBe(
      "req-123:worker.1",
    );
    expect(normalizeCorrelationId("req\nsecret=value")).toBeUndefined();
    expect(normalizeCorrelationId("x".repeat(129))).toBeUndefined();
  });

  test("preserves a safe upstream identifier or generates a UUID", () => {
    expect(resolveCorrelationId("request-1")).toBe("request-1");
    expect(resolveCorrelationId("unsafe value")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
