import { describe, expect, test } from "bun:test";
import { createStepUpAuth, isStepUpVerificationValid } from "./step-up-auth";

const session = { userId: "user-1", sessionId: "session-1" };

function record(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    version: 1,
    purpose: "sensitive-operations",
    userId: session.userId,
    sessionId: session.sessionId,
    verifiedAt: now,
    expiresAt: now + 60,
    ...overrides,
  });
}

describe("step-up verification", () => {
  test("accepts a current verification for the same user and session", () => {
    expect(isStepUpVerificationValid(true, record(), session)).toBe(true);
  });

  test("rejects verification from another session", () => {
    expect(
      isStepUpVerificationValid(true, record(), {
        userId: session.userId,
        sessionId: "session-2",
      }),
    ).toBe(false);
  });

  test("rejects expired verification", () => {
    expect(
      isStepUpVerificationValid(true, record({ expiresAt: 1 }), session),
    ).toBe(false);
  });

  test("keeps non-2FA accounts compatible", () => {
    expect(isStepUpVerificationValid(false, null, session)).toBe(true);
  });

  test("satisfies step-up authentication when 2FA is not enabled", async () => {
    const storage = {
      get: async () => null,
      set: async () => {},
      del: async () => {},
    };
    const stepUp = createStepUpAuth(storage);
    expect(
      await stepUp.isStepUpAuthenticationSatisfied({
        user: { id: "user-1", twoFactorEnabled: false },
        session: { id: "session-1" },
      }),
    ).toBe(true);
    expect(
      await stepUp.isStepUpAuthenticationSatisfied({
        user: { id: "user-1", twoFactorEnabled: null },
        session: { id: "session-1" },
      }),
    ).toBe(true);
    expect(
      await stepUp.isStepUpAuthenticationSatisfied({
        user: { id: "user-1" },
        session: { id: "session-1" },
      }),
    ).toBe(true);
  });
});
