import { describe, expect, test } from "bun:test";
import {
  type AuthConfiguration,
  resolveSharedCookieDomain,
  resolveTrustedOrigins,
} from "./index";

function configuration(
  patch: Partial<AuthConfiguration> = {},
): AuthConfiguration {
  return {
    corsOrigin: "https://dashboard.example.com",
    betterAuthUrl: "https://api.example.com",
    secret: "test-secret-that-is-at-least-32-characters",
    nodeEnv: "test",
    ...patch,
  };
}

describe("authentication origin configuration", () => {
  test("uses only configured exact origins in production", () => {
    expect(
      resolveTrustedOrigins(configuration({ nodeEnv: "production" })),
    ).toEqual(["https://dashboard.example.com", "https://api.example.com"]);
  });

  test("does not infer a shared cookie domain", () => {
    expect(resolveSharedCookieDomain(configuration())).toBeUndefined();
  });

  test("accepts an explicit shared parent domain", () => {
    expect(
      resolveSharedCookieDomain(
        configuration({ sharedCookieDomain: ".example.com" }),
      ),
    ).toBe("example.com");
  });

  test("rejects cookie domains outside either configured host", () => {
    expect(() =>
      resolveSharedCookieDomain(
        configuration({ sharedCookieDomain: "attacker.example" }),
      ),
    ).toThrow("dashboard hostname");
  });
});
