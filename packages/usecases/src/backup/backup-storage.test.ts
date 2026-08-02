import { afterEach, describe, expect, test } from "bun:test";
import {
  appendBoundedBackupError,
  getBackupCommandTimeoutMs,
  MAX_BACKUP_ERROR_OUTPUT_BYTES,
  runProcess,
} from "./backup-storage";

const originalTimeout = process.env.UPSTAND_BACKUP_COMMAND_TIMEOUT_MS;

afterEach(() => {
  if (originalTimeout === undefined) {
    delete process.env.UPSTAND_BACKUP_COMMAND_TIMEOUT_MS;
  } else {
    process.env.UPSTAND_BACKUP_COMMAND_TIMEOUT_MS = originalTimeout;
  }
});

describe("backup command execution", () => {
  test("bounds captured backup command errors", () => {
    expect(appendBoundedBackupError("abc", "def", 5)).toBe("abcde");
    expect(
      appendBoundedBackupError(
        "x".repeat(MAX_BACKUP_ERROR_OUTPUT_BYTES),
        "more",
      ),
    ).toHaveLength(MAX_BACKUP_ERROR_OUTPUT_BYTES);
  });

  test("uses a bounded operator-configurable timeout", () => {
    process.env.UPSTAND_BACKUP_COMMAND_TIMEOUT_MS = "5000";
    expect(getBackupCommandTimeoutMs()).toBe(5000);

    process.env.UPSTAND_BACKUP_COMMAND_TIMEOUT_MS = "999999999999";
    expect(getBackupCommandTimeoutMs()).toBe(24 * 60 * 60_000);

    process.env.UPSTAND_BACKUP_COMMAND_TIMEOUT_MS = "invalid";
    expect(getBackupCommandTimeoutMs()).toBe(30 * 60_000);
  });

  test("fails a command that does not finish before the deadline", async () => {
    process.env.UPSTAND_BACKUP_COMMAND_TIMEOUT_MS = "1000";

    await expect(
      runProcess(process.execPath, ["-e", "setTimeout(() => {}, 5000)"]),
    ).rejects.toThrow("timed out");
  }, 5_000);

  test("passes backup credentials through the child environment", async () => {
    await runProcess(
      process.execPath,
      [
        "-e",
        "if (process.env.UPSTAND_TEST_BACKUP_SECRET !== 'environment-only') process.exit(1)",
      ],
      undefined,
      { UPSTAND_TEST_BACKUP_SECRET: "environment-only" },
    );
  });
});
