import { describe, expect, test } from "bun:test";
import { SecretProviderRegistry } from "./secret-provider.registry";

describe("secret provider outbound policy", () => {
  test("re-resolves allowlisted private provider hosts before connecting", async () => {
    const previousAllowedHosts =
      process.env.UPSTAND_SECRET_PROVIDER_ALLOWED_HOSTS;
    process.env.UPSTAND_SECRET_PROVIDER_ALLOWED_HOSTS = "localhost";
    try {
      const result = await new SecretProviderRegistry().testConnection(
        "vault",
        {
          address: "http://localhost:1",
          path: "secret/app",
          token: "test-token",
        },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("blocked address");
    } finally {
      if (previousAllowedHosts === undefined) {
        delete process.env.UPSTAND_SECRET_PROVIDER_ALLOWED_HOSTS;
      } else {
        process.env.UPSTAND_SECRET_PROVIDER_ALLOWED_HOSTS =
          previousAllowedHosts;
      }
    }
  });
});
