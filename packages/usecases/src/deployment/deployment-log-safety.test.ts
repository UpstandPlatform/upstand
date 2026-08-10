import { describe, expect, test } from "bun:test";
import {
  appendBoundedDeploymentLog,
  redactDeploymentLog,
} from "./deployment-log-safety";

describe("deployment log safety", () => {
  test("redacts common credential forms", () => {
    const output = redactDeploymentLog(
      "token=abc password:xyz Authorization: Bearer bearer-value https://me:pass@example.com",
    );
    expect(output).not.toContain("abc");
    expect(output).not.toContain("xyz");
    expect(output).not.toContain("bearer-value");
    expect(output).not.toContain("me:pass");
  });

  test("bounds durable log storage while keeping recent output", () => {
    const output = appendBoundedDeploymentLog("a".repeat(2_200_000), "tail");
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(output.startsWith("[Earlier deployment logs truncated]")).toBe(true);
    expect(output.endsWith("tail")).toBe(true);
  });
});
