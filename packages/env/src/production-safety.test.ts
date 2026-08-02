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
});
