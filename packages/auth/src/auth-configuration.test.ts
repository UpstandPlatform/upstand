import { describe, expect, test } from "bun:test";
import {
  type AuthConfiguration,
  isPrivateDirectIpHost,
  normalizeDirectIpAuthRequest,
  normalizeDirectIpAuthResponse,
  resolvePasskeyConfiguration,
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
  test("derives the WebAuthn relying party from the configured dashboard origin", () => {
    expect(
      resolvePasskeyConfiguration({
        corsOrigin: "https://dashboard.example.com:8443/path",
      }),
    ).toEqual({
      rpID: "dashboard.example.com",
      origin: "https://dashboard.example.com:8443",
    });
  });

  test("registers the passkey plugin in the Better Auth composition root", async () => {
    const { createAuth } = await import("./index");
    const auth = createAuth({
      database: { db: {} } as never,
      secondaryStorage: {} as never,
      callbacks: {} as never,
      stepUp: {} as never,
      configuration: configuration(),
    });

    expect(auth.options.plugins?.map((plugin) => plugin.id)).toContain(
      "passkey",
    );

    expect(auth.options.account?.additionalFields?.issuer).toMatchObject({
      type: "string",
      required: true,
      defaultValue: "local:credential",
    });
    expect(auth.options.account?.indexes).toContainEqual({
      fields: ["issuer", "accountId"],
      unique: true,
    });
  });

  test("classifies only non-public direct addresses as private bootstrap targets", () => {
    expect(isPrivateDirectIpHost("127.0.0.1")).toBe(true);
    expect(isPrivateDirectIpHost("10.0.0.8")).toBe(true);
    expect(isPrivateDirectIpHost("172.16.0.8")).toBe(true);
    expect(isPrivateDirectIpHost("192.168.1.8")).toBe(true);
    expect(isPrivateDirectIpHost("[fd00::8]")).toBe(true);
    expect(isPrivateDirectIpHost("85.155.230.19")).toBe(false);
    expect(isPrivateDirectIpHost("2001:db8::8")).toBe(false);
  });

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

  test("requires explicit direct-origin bootstrap mode", async () => {
    const { createAuth } = await import("./index");
    const auth = createAuth({
      database: { db: {} } as never,
      secondaryStorage: {} as never,
      callbacks: {} as never,
      stepUp: {} as never,
      configuration: configuration({
        nodeEnv: "production",
        directOrigins: true,
      }),
    });
    const resolver = auth.options.trustedOrigins as (
      request?: Request,
    ) => Promise<string[]>;
    const resolved = await resolver(
      new Request("http://192.168.1.10:3000", {
        headers: { origin: "http://192.168.1.10:3001" },
      }),
    );
    expect(resolved).toContain("http://192.168.1.10:3001");
    expect(resolved).toContain("https://dashboard.example.com");

    const productionAuth = createAuth({
      database: { db: {} } as never,
      secondaryStorage: {} as never,
      callbacks: {} as never,
      stepUp: {} as never,
      configuration: configuration({ nodeEnv: "production" }),
    });
    const productionResolver = productionAuth.options.trustedOrigins as (
      request?: Request,
    ) => Promise<string[]>;
    const productionResolved = await productionResolver(
      new Request("http://192.168.1.10:3000", {
        headers: { origin: "http://192.168.1.10:3001" },
      }),
    );
    expect(productionResolved).not.toContain("http://192.168.1.10:3001");

    const publicIpResolved = await resolver(
      new Request("http://85.155.230.19:3000", {
        headers: { origin: "http://85.155.230.19:3001" },
      }),
    );
    expect(publicIpResolved).not.toContain("http://85.155.230.19:3001");

    const invalidIpResolved = await resolver(
      new Request("http://localhost:3000", {
        headers: { origin: "http://999.999.999.999:3001" },
      }),
    );
    expect(invalidIpResolved).not.toContain("http://999.999.999.999:3001");
  });

  test("normalizes auth cookies for direct HTTP access", () => {
    const response = normalizeDirectIpAuthResponse(
      new Request("http://192.168.1.10:3000/api/auth/sign-in/email"),
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

  test("does not downgrade cookies for direct HTTP access in production", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDirectOrigins = process.env.UPSTAND_DIRECT_ORIGINS;
    process.env.NODE_ENV = "production";
    delete process.env.UPSTAND_DIRECT_ORIGINS;
    try {
      const response = new Response("ok", {
        headers: {
          "set-cookie":
            "__Secure-better-auth.session_token=token; Path=/; Secure; HttpOnly; Domain=.example.com",
        },
      });
      const normalized = normalizeDirectIpAuthResponse(
        new Request("http://192.168.1.10:3000/api/auth/sign-in/email"),
        response,
      );
      expect(normalized).toBe(response);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousDirectOrigins === undefined)
        delete process.env.UPSTAND_DIRECT_ORIGINS;
      else process.env.UPSTAND_DIRECT_ORIGINS = previousDirectOrigins;
    }
  });

  test("does not downgrade cookies when direct origins are enabled without insecure bootstrap", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDirectOrigins = process.env.UPSTAND_DIRECT_ORIGINS;
    const previousInsecureBootstrap =
      process.env.UPSTAND_ALLOW_INSECURE_BOOTSTRAP;
    process.env.NODE_ENV = "production";
    process.env.UPSTAND_DIRECT_ORIGINS = "true";
    delete process.env.UPSTAND_ALLOW_INSECURE_BOOTSTRAP;
    try {
      const response = new Response("ok", {
        headers: {
          "set-cookie":
            "__Secure-better-auth.session_token=token; Path=/; Secure; HttpOnly; Domain=.example.com",
        },
      });
      const normalized = normalizeDirectIpAuthResponse(
        new Request("http://85.155.230.19:3000/api/auth/sign-in/email"),
        response,
      );
      expect(normalized).toBe(response);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousDirectOrigins === undefined)
        delete process.env.UPSTAND_DIRECT_ORIGINS;
      else process.env.UPSTAND_DIRECT_ORIGINS = previousDirectOrigins;
      if (previousInsecureBootstrap === undefined)
        delete process.env.UPSTAND_ALLOW_INSECURE_BOOTSTRAP;
      else
        process.env.UPSTAND_ALLOW_INSECURE_BOOTSTRAP =
          previousInsecureBootstrap;
    }
  });

  test("allows plaintext cookie normalization only for private production bootstrap", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDirectOrigins = process.env.UPSTAND_DIRECT_ORIGINS;
    const previousInsecureBootstrap =
      process.env.UPSTAND_ALLOW_INSECURE_BOOTSTRAP;
    process.env.NODE_ENV = "production";
    process.env.UPSTAND_DIRECT_ORIGINS = "true";
    process.env.UPSTAND_ALLOW_INSECURE_BOOTSTRAP = "true";
    try {
      const response = () =>
        new Response("ok", {
          headers: {
            "set-cookie":
              "__Secure-better-auth.session_token=token; Path=/; Secure; HttpOnly; Domain=.example.com",
          },
        });
      const privateResponse = normalizeDirectIpAuthResponse(
        new Request("http://192.168.1.10:3000/api/auth/sign-in/email"),
        response(),
      );
      expect(privateResponse.headers.get("set-cookie")).not.toMatch(
        /(?:^|;)\s*secure(?:;|$)/i,
      );
      const publicResponse = response();
      expect(
        normalizeDirectIpAuthResponse(
          new Request("http://85.155.230.19:3000/api/auth/sign-in/email"),
          publicResponse,
        ),
      ).toBe(publicResponse);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousDirectOrigins === undefined)
        delete process.env.UPSTAND_DIRECT_ORIGINS;
      else process.env.UPSTAND_DIRECT_ORIGINS = previousDirectOrigins;
      if (previousInsecureBootstrap === undefined)
        delete process.env.UPSTAND_ALLOW_INSECURE_BOOTSTRAP;
      else
        process.env.UPSTAND_ALLOW_INSECURE_BOOTSTRAP =
          previousInsecureBootstrap;
    }
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
