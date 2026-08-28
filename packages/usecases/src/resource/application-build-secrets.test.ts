import { describe, expect, test } from "bun:test";
import { type Resource, ValidationError } from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import { getApplicationBuildSecrets } from "./application-build-secrets";

process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

function resourceWithBuildSecrets(values: Record<string, string>): Resource {
  return {
    buildSecrets: JSON.stringify(encryptSecret(JSON.stringify(values))),
  } as Resource;
}

describe("application build secrets", () => {
  test("returns valid environment-named secrets", () => {
    expect(
      getApplicationBuildSecrets(
        resourceWithBuildSecrets({ NPM_TOKEN: "secret-value" }),
      ),
    ).toEqual({ NPM_TOKEN: "secret-value" });
  });

  test("rejects keys that could alter BuildKit secret option parsing", () => {
    expect(() =>
      getApplicationBuildSecrets(
        resourceWithBuildSecrets({ "TOKEN,src=/etc/passwd": "secret-value" }),
      ),
    ).toThrow(ValidationError);
  });

  test("fails closed when stored build secrets are malformed", () => {
    expect(() =>
      getApplicationBuildSecrets({ buildSecrets: "not-json" } as Resource),
    ).toThrow("Stored application build secrets are invalid");
  });

  test("fails closed when encrypted build secrets cannot be decrypted", () => {
    const resource = resourceWithBuildSecrets({ NPM_TOKEN: "secret-value" });
    resource.buildSecrets = JSON.stringify({
      ciphertext: "tampered",
      iv: "invalid",
      authTag: "invalid",
      keyVersion: 1,
    });

    expect(() => getApplicationBuildSecrets(resource)).toThrow(
      "Stored application build secrets are invalid",
    );
  });
});
