import { describe, expect, test } from "bun:test";
import {
  getDatabaseEnvironment,
  getManagedDatabaseEnvironment,
} from "./database-environment";
import { serializeResourceCredentials } from "./resource-credentials";
import { serializeResourceEnvironmentVariables } from "./resource-environment";

describe("database runtime environment", () => {
  test("derives libSQL basic authentication without exposing plaintext", () => {
    const environment = getDatabaseEnvironment({
      dbType: "libsql",
      credentials: serializeResourceCredentials(
        JSON.stringify({
          dbUser: "admin",
          dbPassword: "secret",
        }),
      ),
      envVars: serializeResourceEnvironmentVariables({}),
    } as never);

    expect(environment.SQLD_HTTP_AUTH).toBe(
      `basic:${Buffer.from("admin:secret").toString("base64")}`,
    );
    expect(JSON.stringify(environment)).not.toContain("secret");
  });

  test("keeps managed credentials separate from user-managed variables", () => {
    const resource = {
      dbType: "postgres",
      credentials: serializeResourceCredentials(
        JSON.stringify({
          dbUser: "app",
          dbPassword: "secret",
          dbName: "appdb",
        }),
      ),
      envVars: serializeResourceEnvironmentVariables({ LOG_LEVEL: "debug" }),
    } as never;

    expect(getManagedDatabaseEnvironment(resource)).toEqual({
      POSTGRES_USER: "app",
      POSTGRES_PASSWORD: "secret",
      POSTGRES_DB: "appdb",
    });
    expect(getDatabaseEnvironment(resource)).toMatchObject({
      LOG_LEVEL: "debug",
      POSTGRES_USER: "app",
    });
  });
});
