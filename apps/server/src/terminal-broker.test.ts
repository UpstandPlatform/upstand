import { describe, expect, test } from "bun:test";
import { matchesTerminalSession } from "./terminal-broker";

const identity = {
  userId: "user-1",
  sessionId: "session-1",
  twoFactorEnabled: true,
};

describe("terminal session identity", () => {
  test("matches the originating user, session, and two-factor state", () => {
    expect(matchesTerminalSession(identity, { ...identity })).toBe(true);
  });

  test("rejects a different user or session", () => {
    expect(
      matchesTerminalSession(identity, { ...identity, userId: "user-2" }),
    ).toBe(false);
    expect(
      matchesTerminalSession(identity, { ...identity, sessionId: "session-2" }),
    ).toBe(false);
  });

  test("rejects a changed two-factor state", () => {
    expect(
      matchesTerminalSession(identity, {
        ...identity,
        twoFactorEnabled: false,
      }),
    ).toBe(false);
  });
});
