import { describe, expect, test } from "bun:test";
import {
  assertSafeProviderUrl,
  redactGitProviderConfig,
  restoreGitProviderConfig,
  validateGitProviderConfig,
} from "./provider-config";

describe("git provider response safety", () => {
  test("redacts credentials while retaining provider metadata", () => {
    const result = JSON.parse(
      redactGitProviderConfig(
        JSON.stringify({
          gitlabUrl: "https://gitlab.example.com",
          applicationId: "public-client-id",
          secret: "oauth-secret",
          accessToken: "access-token",
          refreshToken: "refresh-token",
          groupName: "platform",
        }),
      ),
    );

    expect(result.gitlabUrl).toBe("https://gitlab.example.com");
    expect(result.applicationId).toBe("public-client-id");
    expect(result.groupName).toBe("platform");
    expect(result.secret).toBe("[configured]");
    expect(result.accessToken).toBe("[configured]");
    expect(result.refreshToken).toBe("[configured]");
    expect(JSON.stringify(result)).not.toContain("oauth-secret");
    expect(JSON.stringify(result)).not.toContain("access-token");
  });

  test("preserves secrets when a redacted response is submitted back", () => {
    const merged = JSON.parse(
      restoreGitProviderConfig(
        JSON.stringify({
          accessToken: "old-token",
          gitlabUrl: "https://gitlab.com",
        }),
        JSON.stringify({
          accessToken: "[configured]",
          gitlabUrl: "https://gitlab.example.com",
        }),
      ),
    );
    expect(merged.accessToken).toBe("old-token");
    expect(merged.gitlabUrl).toBe("https://gitlab.example.com");
  });
});

describe("Git provider URL validation", () => {
  test("requires HTTPS and rejects local or private targets", () => {
    expect(() => assertSafeProviderUrl("http://git.example.com")).toThrow();
    expect(() => assertSafeProviderUrl("https://localhost")).toThrow();
    expect(() => assertSafeProviderUrl("https://127.0.0.1")).toThrow();
    expect(() => assertSafeProviderUrl("https://169.254.169.254")).toThrow();
  });

  test("accepts the supported public providers and validates custom config", () => {
    expect(assertSafeProviderUrl("https://gitlab.com/")).toBe(
      "https://gitlab.com",
    );
    expect(() =>
      validateGitProviderConfig(
        "gitea",
        JSON.stringify({ giteaUrl: "https://code.example.com" }),
      ),
    ).not.toThrow();
    expect(() =>
      validateGitProviderConfig("gitea", JSON.stringify({})),
    ).toThrow();
  });
});
