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

describe("terminal broker local sessions", () => {
  test("creates a token for local container terminal session", () => {
    const { terminalBroker } = require("./terminal-broker");
    const token = terminalBroker.create({
      userId: "user-1",
      sessionId: "session-1",
      twoFactorEnabled: false,
      isLocal: true,
      containerId: "cont1",
    });
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  test("handles write, resize, and close gracefully for non-existent token", () => {
    const { terminalBroker } = require("./terminal-broker");
    expect(() => terminalBroker.write("invalid-token", "ls\n")).not.toThrow();
    expect(() =>
      terminalBroker.write("invalid-token", new Uint8Array([1, 2, 3])),
    ).not.toThrow();
    expect(() => terminalBroker.resize("invalid-token", 100, 30)).not.toThrow();
    expect(() => terminalBroker.close("invalid-token")).not.toThrow();
  });
});
