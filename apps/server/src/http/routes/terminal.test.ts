import { expect, test } from "bun:test";
import { decodeTerminalControlFrame } from "./terminal-auth";

test("decodes text and binary terminal authentication frames", () => {
  const frame = JSON.stringify({
    type: "terminal.authenticate",
    token: "session-token",
  });

  expect(decodeTerminalControlFrame(frame)).toBe(frame);
  expect(decodeTerminalControlFrame(new TextEncoder().encode(frame))).toBe(
    frame,
  );
  expect(
    decodeTerminalControlFrame(new TextEncoder().encode(frame).buffer),
  ).toBe(frame);
});

test("rejects unsupported terminal frame payloads", () => {
  expect(decodeTerminalControlFrame({ type: "terminal.authenticate" })).toBe(
    null,
  );
});
