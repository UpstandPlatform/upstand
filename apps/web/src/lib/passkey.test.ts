import { describe, expect, test } from "bun:test";
import {
  isPasskeySupported,
  normalizePasskeyName,
  PASSKEY_NAME_MAX_LENGTH,
} from "./passkey";

describe("passkey helpers", () => {
  test("normalizes and bounds passkey labels", () => {
    expect(normalizePasskeyName("  MacBook Touch ID  ")).toBe(
      "MacBook Touch ID",
    );
    expect(
      normalizePasskeyName("x".repeat(PASSKEY_NAME_MAX_LENGTH + 10)),
    ).toHaveLength(PASSKEY_NAME_MAX_LENGTH);
  });

  test("does not report passkey support during server-side rendering", () => {
    expect(isPasskeySupported()).toBe(false);
  });
});
