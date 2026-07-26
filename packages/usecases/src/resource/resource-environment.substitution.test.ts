import { describe, expect, test } from "bun:test";
import {
  resolveResourceEnvironmentVariables,
  substituteProjectEnvVars,
} from "./resource-environment";

const projectRef = (name: string) => `\${{project.${name}}}`;
const paddedProjectRef = (name: string) => `\${{ project.${name} }}`;

describe("substituteProjectEnvVars", () => {
  test("replaces a simple project variable reference", () => {
    const result = substituteProjectEnvVars(
      { DATABASE_URL: projectRef("DATABASE_URL") },
      { DATABASE_URL: "postgres://user:pass@db:5432/app" },
    );
    expect(result).toEqual({
      DATABASE_URL: "postgres://user:pass@db:5432/app",
    });
  });

  test("resolves whitespace-padded project variable reference", () => {
    const result = substituteProjectEnvVars(
      { DB: paddedProjectRef("DATABASE_URL") },
      { DATABASE_URL: "pg://host/db" },
    );
    expect(result).toEqual({ DB: "pg://host/db" });
  });

  test("resolves multiple references in the same value", () => {
    const result = substituteProjectEnvVars(
      {
        DSN: `postgres://${projectRef("DB_USER")}:${projectRef("DB_PASS")}@db/app`,
      },
      { DB_USER: "admin", DB_PASS: "secret" },
    );
    expect(result).toEqual({
      DSN: "postgres://admin:secret@db/app",
    });
  });

  test("resolves to empty string when project variable is missing", () => {
    const result = substituteProjectEnvVars(
      { KEY: projectRef("MISSING_VAR") },
      {},
    );
    expect(result).toEqual({ KEY: "" });
  });

  test("passes through values without references unchanged", () => {
    const result = substituteProjectEnvVars(
      { PLAIN: "just-a-value", PORT: "3000" },
      { OTHER: "ignored" },
    );
    expect(result).toEqual({ PLAIN: "just-a-value", PORT: "3000" });
  });

  test("does not transform keys", () => {
    const result = substituteProjectEnvVars(
      { [projectRef("KEY")]: "value" },
      { KEY: "should-not-touch-keys" },
    );
    expect(result).toEqual({ [projectRef("KEY")]: "value" });
  });

  test("returns an empty object when no resource vars provided", () => {
    const result = substituteProjectEnvVars({}, { ANY: "val" });
    expect(result).toEqual({});
  });

  test("handles mixed references and plain values in the same record", () => {
    const result = substituteProjectEnvVars(
      {
        DB: projectRef("DB_URL"),
        PORT: "8080",
        REDIS: projectRef("REDIS_URL"),
      },
      { DB_URL: "pg://localhost/db", REDIS_URL: "redis://localhost" },
    );
    expect(result).toEqual({
      DB: "pg://localhost/db",
      PORT: "8080",
      REDIS: "redis://localhost",
    });
  });
});

describe("resolveResourceEnvironmentVariables", () => {
  test("returns empty object for null inputs", () => {
    expect(resolveResourceEnvironmentVariables(null, null)).toEqual({});
  });

  test("returns parsed resource vars when no project vars set", () => {
    const resourceJson = JSON.stringify({ PORT: "3000" });
    const result = resolveResourceEnvironmentVariables(resourceJson, null);
    expect(result).toEqual({ PORT: "3000" });
  });

  test("substitutes project vars when both are plain JSON (legacy format)", () => {
    const resourceJson = JSON.stringify({
      DB: projectRef("DATABASE_URL"),
      APP: "myapp",
    });
    const projectJson = JSON.stringify({ DATABASE_URL: "pg://db/prod" });
    const result = resolveResourceEnvironmentVariables(
      resourceJson,
      projectJson,
    );
    expect(result).toEqual({ DB: "pg://db/prod", APP: "myapp" });
  });

  test("unresolvable project references resolve to empty string", () => {
    const resourceJson = JSON.stringify({ KEY: projectRef("NOPE") });
    const result = resolveResourceEnvironmentVariables(resourceJson, "{}");
    expect(result).toEqual({ KEY: "" });
  });
});
