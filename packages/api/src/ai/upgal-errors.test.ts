import { describe, expect, it } from "bun:test";
import { classifyUpGalError, UpGalError } from "./upgal-errors";

describe("classifyUpGalError", () => {
  it("returns actionable configuration guidance without exposing provider details", () => {
    expect(
      classifyUpGalError(
        new UpGalError("configuration", "provider is not configured"),
      ),
    ).toEqual({
      code: "configuration",
      status: 503,
      retryable: false,
      userMessage: expect.stringContaining("configured AI provider"),
    });
  });

  it("marks transient provider failures as retryable", () => {
    expect(
      classifyUpGalError(new UpGalError("rate_limit", "provider throttled")),
    ).toMatchObject({
      code: "rate_limit",
      status: 429,
      retryable: true,
    });
  });

  it("maps malformed requests to a non-retryable validation error", () => {
    expect(
      classifyUpGalError(new UpGalError("validation", "invalid arguments")),
    ).toMatchObject({
      code: "validation",
      status: 400,
      retryable: false,
    });
  });

  it("does not classify arbitrary provider text by message", () => {
    expect(classifyUpGalError(new Error("429 rate limit exceeded")).code).toBe(
      "provider",
    );
  });
});
