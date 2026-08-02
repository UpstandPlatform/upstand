import { describe, expect, test } from "bun:test";
import { redactLogOutput } from "./redact-log-output";

describe("redactLogOutput", () => {
  test("removes common credentials while retaining log context", () => {
    const output = redactLogOutput(
      "request token=abc123 Authorization: Bearer xyz password: p@ss https://user:pass@example.com",
    );

    expect(output).toContain("request");
    expect(output).not.toContain("abc123");
    expect(output).not.toContain("xyz");
    expect(output).not.toContain("p@ss");
    expect(output).not.toContain("user:pass");
  });
});
