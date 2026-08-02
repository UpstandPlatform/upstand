import { expect, test } from "bun:test";
import {
  appendBoundedSshOutput,
  MAX_SSH_STDOUT_BYTES,
} from "./server-provisioning";

test("remote SSH output is bounded before it is accumulated", () => {
  expect(
    appendBoundedSshOutput("prefix", "suffix", MAX_SSH_STDOUT_BYTES, "stdout"),
  ).toBe("prefixsuffix");

  expect(() =>
    appendBoundedSshOutput(
      "x".repeat(MAX_SSH_STDOUT_BYTES),
      "y",
      MAX_SSH_STDOUT_BYTES,
      "stdout",
    ),
  ).toThrow("SSH stdout output exceeded");
});
