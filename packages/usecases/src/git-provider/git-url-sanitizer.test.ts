import { describe, expect, test } from "bun:test";
import { assertSafeGitRef, sanitizeGitUrl } from "./git-url-sanitizer";

describe("git-url-sanitizer", () => {
  test("accepts valid HTTPS and SSH git URLs", () => {
    expect(sanitizeGitUrl("https://github.com/user/repo.git")).toBe(
      "https://github.com/user/repo.git",
    );
    expect(sanitizeGitUrl("git@github.com:user/repo.git")).toBe(
      "git@github.com:user/repo.git",
    );
  });

  test("rejects URLs starting with dashes or options flags", () => {
    expect(() => sanitizeGitUrl("--upload-pack=touch /tmp/pwned")).toThrow(
      "Git URL cannot start with a dash or flag parameter",
    );
    expect(() => sanitizeGitUrl("-oProxyCommand=calc.exe")).toThrow(
      "Git URL cannot start with a dash or flag parameter",
    );
  });

  test("rejects URLs containing spaces or newline control characters", () => {
    expect(() => sanitizeGitUrl("https://github.com/user/repo.git\n")).toThrow(
      "Git URL contains invalid control characters",
    );
    expect(() =>
      sanitizeGitUrl("https://github.com/user/repo.git arg"),
    ).toThrow("Git URL cannot contain whitespace");
    expect(() =>
      sanitizeGitUrl("https://github.com/user/repo.git\targ"),
    ).toThrow("Git URL cannot contain whitespace");
  });

  test("accepts ordinary branch names and rejects option-like refs", () => {
    expect(assertSafeGitRef("feature/health-checks")).toBe(
      "feature/health-checks",
    );
    expect(() => assertSafeGitRef("--upload-pack=touch")).toThrow();
    expect(() => assertSafeGitRef("feature/../main")).toThrow();
    expect(() => assertSafeGitRef("feature\\main")).toThrow();
  });
});
