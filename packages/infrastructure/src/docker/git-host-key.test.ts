import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  bindKnownHostLine,
  isSshGitUrl,
  matchingKnownHostLines,
} from "./git-host-key";

describe("Git SSH host-key pinning", () => {
  test("recognizes URL and scp-style SSH repositories", () => {
    expect(isSshGitUrl("ssh://git@example.com/team/app.git")).toBe(true);
    expect(isSshGitUrl("git@example.com:team/app.git")).toBe(true);
    expect(isSshGitUrl("git@[2001:db8::1]:team/app.git")).toBe(true);
    expect(isSshGitUrl("https://github.com/team/app.git")).toBe(false);
  });

  test("selects only scanned host keys matching the configured fingerprint", () => {
    const keyBytes = Buffer.from("synthetic-ed25519-key");
    const fingerprint = `SHA256:${createHash("sha256")
      .update(keyBytes)
      .digest("base64")}`;
    const matching = `example.com ssh-ed25519 ${keyBytes.toString("base64")}`;
    const different = `example.com ssh-rsa ${Buffer.from("other-key").toString("base64")}`;

    expect(
      matchingKnownHostLines(`${matching}\n${different}\n`, fingerprint),
    ).toEqual([matching]);
  });

  test("binds an IP-scanned key back to the Git hostname", () => {
    expect(
      bindKnownHostLine("10.0.0.8 ssh-ed25519 synthetic-key", {
        host: "git.internal.example",
        port: 22,
      }),
    ).toBe("git.internal.example ssh-ed25519 synthetic-key");
    expect(
      bindKnownHostLine("10.0.0.8 ssh-ed25519 synthetic-key", {
        host: "git.internal.example",
        port: 2222,
      }),
    ).toBe("[git.internal.example]:2222 ssh-ed25519 synthetic-key");
  });
});
