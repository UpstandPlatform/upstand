import { describe, expect, test } from "bun:test";
import { isStepUpVerificationValid } from "./step-up-auth";

describe("step-up authentication", () => {
  test("does not require verification when two-factor authentication is disabled", () => {
    expect(isStepUpVerificationValid(false, null)).toBe(true);
  });

  test("requires the exact verified marker when two-factor authentication is enabled", () => {
    expect(isStepUpVerificationValid(true, "true")).toBe(false);
    expect(isStepUpVerificationValid(true, "1")).toBe(false);
    expect(isStepUpVerificationValid(true, "verified")).toBe(false);
    expect(isStepUpVerificationValid(true, null)).toBe(false);
  });

  test("binds verification to the current user and session", () => {
    const now = Math.floor(Date.now() / 1000);
    const value = JSON.stringify({
      version: 1,
      purpose: "sensitive-operations",
      userId: "user-1",
      sessionId: "session-1",
      verifiedAt: now,
      expiresAt: now + 60,
    });
    expect(
      isStepUpVerificationValid(true, value, {
        userId: "user-1",
        sessionId: "session-1",
      }),
    ).toBe(true);
    expect(
      isStepUpVerificationValid(true, value, {
        userId: "user-2",
        sessionId: "session-1",
      }),
    ).toBe(false);
  });
});
