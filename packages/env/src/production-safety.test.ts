import { describe, expect, test } from "bun:test";
import { assertSecureProductionOrigins } from "./production-safety";

const secureOrigins = {
  nodeEnv: "production",
  allowInsecureBootstrap: false,
  betterAuthUrl: "https://api.example.com",
  corsOrigin: "https://app.example.com",
};

describe("production origin safety", () => {
  test("accepts separate HTTPS origins without credentials", () => {
    expect(() => assertSecureProductionOrigins(secureOrigins)).not.toThrow();
  });

  test("rejects HTTP origins unless bootstrap mode is explicit", () => {
    expect(() =>
      assertSecureProductionOrigins({
        ...secureOrigins,
        betterAuthUrl: "http://api.example.com",
      }),
    ).toThrow("BETTER_AUTH_URL must use an HTTPS origin");
  });

  test("allows only the explicit insecure bootstrap exception", () => {
    expect(() =>
      assertSecureProductionOrigins({
        ...secureOrigins,
        allowInsecureBootstrap: true,
        betterAuthUrl: "http://192.0.2.10:3000",
        corsOrigin: "http://192.0.2.10:3001",
      }),
    ).not.toThrow();
  });

  test("allows only loopback HTTP origins for the production desktop runtime", () => {
    expect(() =>
      assertSecureProductionOrigins({
        ...secureOrigins,
        platform: "desktop",
        betterAuthUrl: "http://127.0.0.1:54319",
        corsOrigin: "http://[::1]:3000",
      }),
    ).not.toThrow();

    expect(() =>
      assertSecureProductionOrigins({
        ...secureOrigins,
        platform: "desktop",
        betterAuthUrl: "http://localhost:54319",
        corsOrigin: "http://127.0.0.1:3000",
      }),
    ).not.toThrow();

    expect(() =>
      assertSecureProductionOrigins({
        ...secureOrigins,
        platform: "desktop",
        betterAuthUrl: "http://192.0.2.10:54319",
      }),
    ).toThrow("BETTER_AUTH_URL must use an HTTPS origin");
  });

  test("does not treat cloud origins as desktop loopback origins", () => {
    expect(() =>
      assertSecureProductionOrigins({
        ...secureOrigins,
        platform: "cloud",
        betterAuthUrl: "http://127.0.0.1:54319",
        corsOrigin: "http://127.0.0.1:3000",
      }),
    ).toThrow("BETTER_AUTH_URL must use an HTTPS origin");
  });
});
