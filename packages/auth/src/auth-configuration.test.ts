import { describe, expect, test } from "bun:test";
import {
  type AuthConfiguration,
  normalizeDirectIpAuthRequest,
  normalizeDirectIpAuthResponse,
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

  test("normalizes auth cookies for direct HTTP access", () => {
    const response = normalizeDirectIpAuthResponse(
      new Request("http://85.155.230.19:3000/api/auth/sign-in/email"),
      new Response("ok", {
        headers: {
          "set-cookie":
            "__Secure-better-auth.session_token=token; Path=/; Secure; HttpOnly; Domain=.upstand.dev; SameSite=Lax",
        },
      }),
    );

    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("better-auth.session_token=token");
    expect(cookie).not.toMatch(/(?:^|;)\s*secure(?:;|$)/i);
    expect(cookie).not.toMatch(/(?:^|;)\s*domain=/i);
  });

  test("does not change cookies for configured HTTPS access", () => {
    const response = new Response("ok", {
      headers: {
        "set-cookie": "session=token; Path=/; Secure; Domain=.example.com",
      },
    });

    const normalized = normalizeDirectIpAuthResponse(
      new Request("https://dashboard.example.com/api/auth/sign-in/email"),
      response,
    );

    expect(normalized).toBe(response);
  });

  test("aliases direct-IP cookies for secure Better Auth configurations", () => {
    const request = normalizeDirectIpAuthRequest(
      new Request("http://85.155.230.19:3000/api/trpc", {
        headers: {
          cookie: "better-auth.session_token=signed-token",
        },
      }),
    );

    expect(request.headers.get("cookie")).toContain(
      "better-auth.session_token=signed-token",
    );
    expect(request.headers.get("cookie")).toContain(
      "__Secure-better-auth.session_token=signed-token",
    );
  });
});
