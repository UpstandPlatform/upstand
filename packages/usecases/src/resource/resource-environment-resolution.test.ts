import { describe, expect, test } from "bun:test";
import {
  extractAndParametrizeEnvVars,
  parseResourceEnvironmentVariables,
  resolveResourceBuildEnvironmentVariables,
  resolveResourceEnvironmentVariables,
  serializeResourceEnvironmentVariables,
  substituteProjectEnvVars,
} from "./resource-environment";

describe("Environment Variable & Secret Resolution Edge Cases", () => {
  test(
    "resolves both $" + "{{project.VAR}} and $" + "{{env.VAR}} references",
    () => {
      const resourceVars = {
        DATABASE_URL:
          "$" + "{{project.DB_HOST}}:$" + "{{project.DB_PORT}}/mydb",
        API_KEY: "$" + "{{env.GLOBAL_API_KEY}}",
        STATIC_VAL: "constant",
      };

      const projectVars = {
        DB_HOST: "postgres.internal",
        DB_PORT: "5432",
        GLOBAL_API_KEY: "secret-key-123",
      };

      const resolved = substituteProjectEnvVars(resourceVars, projectVars);

      expect(resolved).toEqual({
        DATABASE_URL: "postgres.internal:5432/mydb",
        API_KEY: "secret-key-123",
        STATIC_VAL: "constant",
      });
    },
  );

  test("handles missing project keys by replacing with empty string", () => {
    const resourceVars = {
      MISSING_VAR: "prefix_$" + "{{project.NON_EXISTENT}}_suffix",
    };
    const resolved = substituteProjectEnvVars(resourceVars, {});
    expect(resolved.MISSING_VAR).toBe("prefix__suffix");
  });

  test("preserves special characters like $, \\, and bcrypt hashes in secret values", () => {
    const secretHash = "$2a$12$e86..9.a./.1234567890abcdefghijk";
    const resourceVars = {
      PASS_HASH: "$" + "{{project.HASH_KEY}}",
    };
    const projectVars = {
      HASH_KEY: secretHash,
    };

    const resolved = substituteProjectEnvVars(resourceVars, projectVars);
    expect(resolved.PASS_HASH).toBe(secretHash);
  });

  test("correctly encrypts and decrypts environment variables", () => {
    const rawVars = { FOO: "bar", SECRET: "pass123" };
    const serialized = serializeResourceEnvironmentVariables(rawVars);

    expect(typeof serialized).toBe("string");
    expect(serialized).not.toContain("pass123"); // Should be encrypted

    const parsed = parseResourceEnvironmentVariables(serialized);
    expect(parsed).toEqual(rawVars);
  });

  test("end-to-end resolution with raw encrypted strings", () => {
    const encryptedResource = serializeResourceEnvironmentVariables({
      PORT: "8080",
      URL: "https://$" + "{{project.HOST}}/app",
    });
    const encryptedProject = serializeResourceEnvironmentVariables({
      HOST: "example.com",
    });

    const resolved = resolveResourceEnvironmentVariables(
      encryptedResource,
      encryptedProject,
    );

    expect(resolved).toEqual({
      PORT: "8080",
      URL: "https://example.com/app",
    });
  });

  test("layers build-only variables without mutating the runtime set", () => {
    const runtime = serializeResourceEnvironmentVariables({
      NODE_ENV: "production",
      API_URL: "https://$" + "{{project.API_HOST}}",
    });
    const buildOnly = serializeResourceEnvironmentVariables({
      API_URL: "https://build.$" + "{{project.API_HOST}}",
      PUBLIC_PATH: "/assets",
    });
    const project = serializeResourceEnvironmentVariables({
      API_HOST: "api.example.com",
    });

    expect(resolveResourceEnvironmentVariables(runtime, project)).toEqual({
      NODE_ENV: "production",
      API_URL: "https://api.example.com",
    });
    expect(
      resolveResourceBuildEnvironmentVariables(buildOnly, runtime, project),
    ).toEqual({
      NODE_ENV: "production",
      API_URL: "https://build.api.example.com",
      PUBLIC_PATH: "/assets",
    });
  });

  test("extracts and parametrizes compose YAML environment variables", () => {
    const composeYaml = `
version: '3.8'
services:
  web:
    image: nginx:alpine
    environment:
      - PORT=8080
      - MODE=production
  api:
    image: node:18
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
`;

    const { composeFile, envVars } = extractAndParametrizeEnvVars(composeYaml);

    expect(envVars).toEqual({
      PORT: "8080",
      MODE: "production",
      DB_HOST: "postgres",
      DB_PORT: "5432",
    });

    expect(composeFile).toContain("$" + "{PORT}");
    expect(composeFile).toContain("$" + "{DB_HOST}");
  });
});
