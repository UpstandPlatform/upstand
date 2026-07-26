import { beforeEach, describe, expect, test } from "bun:test";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import {
  parseResourceCredentials,
  resourceCredentialsJson,
  serializeResourceCredentials,
} from "./resource-credentials";

beforeEach(() => {
  process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 23).toString("base64");
});

describe("resource credential storage", () => {
  test("encrypts a credential document and reads it back", () => {
    const plaintext = JSON.stringify({
      repository: "acme/api",
      token: "secret",
    });
    const stored = serializeResourceCredentials(plaintext);

    expect(stored).not.toBe(plaintext);
    expect(parseResourceCredentials(stored)).toEqual({
      repository: "acme/api",
      token: "secret",
    });
    expect(resourceCredentialsJson({ credentials: stored })).toBe(plaintext);
  });

  test("keeps legacy plaintext and database-only envelopes readable", () => {
    const plaintext = JSON.stringify({ composeFile: "services: {}" });
    const legacyDatabaseEnvelope = JSON.stringify(encryptSecret(plaintext));

    expect(parseResourceCredentials(plaintext)).toEqual({
      composeFile: "services: {}",
    });
    expect(parseResourceCredentials(legacyDatabaseEnvelope)).toEqual({
      composeFile: "services: {}",
    });
  });

  test("does not re-encrypt an already encrypted document", () => {
    const stored = serializeResourceCredentials(
      JSON.stringify({
        autoDeploy: true,
      }),
    );
    expect(serializeResourceCredentials(stored)).toBe(stored);
  });
});
