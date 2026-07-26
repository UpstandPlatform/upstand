import { describe, expect, test } from "bun:test";
import {
  createGitProviderOAuthState,
  gitProviderOAuthStateKey,
  parseGitProviderOAuthState,
} from "./oauth-state";

process.env.BETTER_AUTH_SECRET ??=
  "test-oauth-state-secret-that-is-long-enough";

describe("Git provider OAuth state", () => {
  test("creates and verifies a provider-bound state", () => {
    const created = createGitProviderOAuthState(
      "provider-1",
      "provider-oauth",
      {
        organizationId: "org-1",
        userId: "user-1",
      },
    );
    expect(parseGitProviderOAuthState(created.state)).toEqual({
      providerId: "provider-1",
      purpose: "provider-oauth",
      organizationId: "org-1",
      userId: "user-1",
      nonce: expect.any(String),
      expiresAt: created.expiresAt,
    });
    expect(gitProviderOAuthStateKey(created.state)).toContain(
      "oauth:git-provider-state:",
    );
  });

  test("rejects tampering and expired state", () => {
    const created = createGitProviderOAuthState(
      "provider-1",
      "provider-oauth",
      {
        organizationId: "org-1",
        userId: "user-1",
      },
    );
    expect(parseGitProviderOAuthState(`${created.state}tampered`)).toBeNull();

    const originalNow = Date.now;
    Date.now = () => (created.expiresAt + 1) * 1000;
    try {
      expect(parseGitProviderOAuthState(created.state)).toBeNull();
    } finally {
      Date.now = originalNow;
    }
  });
});
