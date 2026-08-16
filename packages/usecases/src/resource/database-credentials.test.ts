import { describe, expect, test } from "bun:test";
import { ValidationError } from "@upstand/domain";
import {
  assertManagedDatabaseCredentials,
  ensureManagedDatabaseCredentials,
} from "./database-credentials";

describe("managed database credentials", () => {
  test("generates unique credentials for each supported database type", () => {
    for (const databaseType of [
      "postgres",
      "mysql",
      "mariadb",
      "mongodb",
      "redis",
      "libsql",
    ]) {
      const credentials = ensureManagedDatabaseCredentials(databaseType, {});
      expect(
        Object.values(credentials).every(
          (value) => value !== "upstand-password",
        ),
      ).toBe(true);
      expect(
        Object.values(credentials).some(
          (value) => typeof value === "string" && value.length >= 32,
        ),
      ).toBe(true);
    }
  });

  test("preserves explicitly configured credentials", () => {
    const credentials = ensureManagedDatabaseCredentials("postgres", {
      dbUser: "app",
      dbPassword: "provided",
      dbName: "production",
    });

    expect(credentials).toEqual({
      dbUser: "app",
      dbPassword: "provided",
      dbName: "production",
    });
  });

  test("fails closed when a resource has no managed authentication", () => {
    expect(() => assertManagedDatabaseCredentials("postgres", {})).toThrow(
      ValidationError,
    );
    expect(() =>
      assertManagedDatabaseCredentials("redis", { REDIS_PASSWORD: " " }),
    ).toThrow(/REDIS_PASSWORD/);
  });
});
