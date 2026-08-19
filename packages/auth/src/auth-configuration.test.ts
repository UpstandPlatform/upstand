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

  test("dynamically includes direct host request origins in trustedOrigins", async () => {
    const { createAuth } = await import("./index");
    const auth = createAuth({
      database: { db: {} } as never,
      secondaryStorage: {} as never,
      callbacks: {} as never,
      stepUp: {} as never,
      configuration: configuration({ nodeEnv: "production" }),
    });
    const resolver = auth.options.trustedOrigins as (
      request?: Request,
    ) => Promise<string[]>;
    const resolved = await resolver(
      new Request("http://localhost:3000", {
        headers: { origin: "http://85.155.230.19:3001" },
      }),
    );
    expect(resolved).toContain("http://85.155.230.19:3001");
    expect(resolved).toContain("https://dashboard.example.com");

    const invalidIpResolved = await resolver(
      new Request("http://localhost:3000", {
        headers: { origin: "http://999.999.999.999:3001" },
      }),
    );
    expect(invalidIpResolved).not.toContain("http://999.999.999.999:3001");
  });
});
