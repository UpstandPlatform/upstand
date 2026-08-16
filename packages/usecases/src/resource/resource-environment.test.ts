import { describe, expect, test } from "bun:test";
import {
  extractAndParametrizeEnvVars,
  parseResourceEnvironmentVariables,
  serializeResourceEnvironmentVariables,
} from "./resource-environment";

process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

test("resource environment variables encrypt on write and decrypt on read", () => {
  const serialized = serializeResourceEnvironmentVariables({
    API_KEY: "secret-value",
    PORT: "8080",
  });

  expect(serialized).not.toContain("secret-value");
  expect(parseResourceEnvironmentVariables(serialized)).toEqual({
    API_KEY: "secret-value",
    PORT: "8080",
  });
});

test("rejects unencrypted resource environment variables", () => {
  expect(
    parseResourceEnvironmentVariables(
      JSON.stringify({ UNENCRYPTED_TOKEN: "rejected" }),
    ),
  ).toEqual({});
});

test("rejects unsafe environment variable names before persisting", () => {
  expect(() =>
    serializeResourceEnvironmentVariables({
      "TOKEN,src=/etc/passwd": "secret",
    }),
  ).toThrow("Invalid environment variables");
  expect(
    parseResourceEnvironmentVariables(
      JSON.stringify({ "TOKEN,src=/etc/passwd": "secret" }),
    ),
  ).toEqual({});
});

describe("extractAndParametrizeEnvVars", () => {
  test("extracts env vars from map-style compose environment", () => {
    const compose = `
services:
  web:
    image: nginx
    environment:
      API_KEY: my-secret
      PORT: "3000"
`.trim();

    const { composeFile, envVars } = extractAndParametrizeEnvVars(compose);

    expect(envVars).toEqual({ API_KEY: "my-secret", PORT: "3000" });
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing literal template variable replacement in YAML
    expect(composeFile).toContain("${API_KEY}");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing literal template variable replacement in YAML
    expect(composeFile).toContain("${PORT}");
    expect(composeFile).not.toContain("my-secret");
  });

  test("extracts env vars from list-style compose environment", () => {
    const compose = `
services:
  app:
    image: myapp
    environment:
      - DATABASE_URL=postgres://db:5432/prod
      - DEBUG=false
`.trim();

    const { envVars } = extractAndParametrizeEnvVars(compose);

    expect(envVars).toEqual({
      DATABASE_URL: "postgres://db:5432/prod",
      DEBUG: "false",
    });
  });

  test("returns original compose file unchanged when parsing fails", () => {
    const invalid = "NOT VALID YAML: {{{";
    const { composeFile, envVars } = extractAndParametrizeEnvVars(invalid);
    expect(composeFile).toBe(invalid);
    expect(envVars).toEqual({});
  });

  test("returns empty envVars for a compose file with no environment section", () => {
    const compose = `
services:
  db:
    image: postgres:16
`.trim();

    const { envVars } = extractAndParametrizeEnvVars(compose);
    expect(envVars).toEqual({});
  });
});
