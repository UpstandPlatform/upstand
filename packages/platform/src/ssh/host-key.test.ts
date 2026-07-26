import { describe, expect, test } from "bun:test";
import {
  hostVerifierForFingerprint,
  normalizeHostKeyFingerprint,
  verifyHostKeyFingerprint,
} from "./host-key";

describe("SSH host key verification", () => {
  const fingerprint = "SHA256/invalid";

  test("accepts only the persisted SHA256 fingerprint format", () => {
    expect(() => normalizeHostKeyFingerprint(fingerprint)).toThrow();
    expect(() => normalizeHostKeyFingerprint("SHA256:YWJjZA==")).not.toThrow();
  });

  test("fails closed when the presented key does not match", () => {
    const expected = "SHA256:YWJjZA==";
    expect(verifyHostKeyFingerprint(expected, "SHA256:ZGVmZw==")).toBe(false);
    expect(hostVerifierForFingerprint(expected)("SHA256:YWJjZA==")).toBe(true);
  });

  test("accepts the bare SHA256 value returned by ssh2", () => {
    const expected = "SHA256:YWJjZA==";
    expect(hostVerifierForFingerprint(expected)("YWJjZA==")).toBe(true);
    expect(hostVerifierForFingerprint(expected)("ZGVmZw==")).toBe(false);
  });

  test("accepts ssh2's hexadecimal SHA256 digest", () => {
    const expected = "SHA256:mVZTVhJlmPwfFCRvY7mmtekfNcDBcjU5jWYaTrTc6us";
    expect(
      hostVerifierForFingerprint(expected)(
        "99565356126598fc1f14246f63b9a6b5e91f35c0c17235398d661a4eb4dceaeb",
      ),
    ).toBe(true);
    expect(
      hostVerifierForFingerprint(expected)(
        "89565356126598fc1f14246f63b9a6b5e91f35c0c17235398d661a4eb4dceaeb",
      ),
    ).toBe(false);
  });
});
