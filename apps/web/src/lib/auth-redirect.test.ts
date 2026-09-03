import { describe, expect, test } from "bun:test";
import {
  getLoginSuccessPath,
  getSafeAuthRedirect,
  getTwoFactorRedirectPath,
} from "./auth-redirect";

describe("authentication redirect helpers", () => {
  test("keeps valid protected paths and query strings", () => {
    expect(getSafeAuthRedirect("/projects?filter=running#resources")).toBe(
      "/projects?filter=running#resources",
    );
  });

  test("rejects external and browser-confusing redirect targets", () => {
    for (const value of [
      "https://attacker.example",
      "//attacker.example/login",
      "/\\\\attacker.example",
      "/projects\\\\..\\\\login",
      "javascript:alert(1)",
    ]) {
      expect(getSafeAuthRedirect(value)).toBe("/dashboard");
    }
  });

  test("uses the CLI authorization flow before a normal return path", () => {
    expect(
      getLoginSuccessPath(
        new URLSearchParams(
          "cli=upstand-cli&user_code=AB%20CD&return_to=%2Fprojects",
        ),
      ),
    ).toBe("/login?cli=upstand-cli&user_code=AB%20CD");
  });

  test("falls back to the dashboard for missing or malformed return paths", () => {
    expect(getLoginSuccessPath(new URLSearchParams())).toBe("/dashboard");
    expect(
      getLoginSuccessPath(new URLSearchParams("return_to=https%3A%2F%2Fevil")),
    ).toBe("/dashboard");
  });

  test("carries the safe login target through the two-factor challenge", () => {
    expect(
      getTwoFactorRedirectPath(
        new URLSearchParams("return_to=%2Fprojects%3Ffilter%3Dactive"),
      ),
    ).toBe("/2fa-verify?return_to=%2Fprojects%3Ffilter%3Dactive");
  });
});
