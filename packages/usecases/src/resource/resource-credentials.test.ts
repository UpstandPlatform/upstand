import { beforeEach, describe, expect, test } from "bun:test";
import {
  parseResourceCredentials,
  parseResourceCredentialsStrict,
  ResourceCredentialsError,
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

  test("rejects unencrypted credential documents", () => {
    const plaintext = JSON.stringify({ composeFile: "services: {}" });
    expect(parseResourceCredentials(plaintext)).toEqual({});
  });

  test("does not re-encrypt an already encrypted document", () => {
    const stored = serializeResourceCredentials(
      JSON.stringify({
        autoDeploy: true,
      }),
    );
    expect(serializeResourceCredentials(stored)).toBe(stored);
  });

  test("fails closed for invalid credential documents", () => {
    expect(parseResourceCredentials("not-json")).toEqual({});
    expect(() => parseResourceCredentialsStrict("not-json")).toThrow(
      ResourceCredentialsError,
    );
    expect(() => parseResourceCredentialsStrict(JSON.stringify([]))).toThrow(
      ResourceCredentialsError,
    );
  });

  test("keeps preview credential overrides encrypted", () => {
    const stored = serializeResourceCredentials({
      repositoryUrl: "https://github.com/UpstandPlatform/upstand.git",
      branch: "main",
    });
    const parsed = parseResourceCredentialsStrict(stored);
    parsed.branch = "preview-branch";
    const updated = serializeResourceCredentials(parsed);

    expect(updated).not.toContain("preview-branch");
    expect(parseResourceCredentialsStrict(updated).branch).toBe(
      "preview-branch",
    );
  });
});
