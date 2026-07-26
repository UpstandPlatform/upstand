import { describe, expect, test } from "bun:test";
import { ValidationError } from "@upstand/domain";
import {
  LIBSQL_CONTAINER_PORTS,
  validateLibsqlSettings,
} from "./libsql-settings";

describe("libSQL settings", () => {
  test("documents Dokploy-compatible container endpoints", () => {
    expect(LIBSQL_CONTAINER_PORTS).toEqual({
      http: 8080,
      grpc: 5001,
      admin: 5000,
    });
  });

  test("rejects duplicate published ports", () => {
    expect(() => validateLibsqlSettings("libsql", 5001, 5001)).toThrow(
      ValidationError,
    );
    expect(() => validateLibsqlSettings("libsql", 5001, null, 5001)).toThrow(
      ValidationError,
    );
    expect(() => validateLibsqlSettings("libsql", null, null, 5001)).toThrow(
      ValidationError,
    );
  });

  test("rejects libSQL-only settings on another engine", () => {
    expect(() => validateLibsqlSettings("postgres", 5001, null)).toThrow(
      "only be configured for libSQL",
    );
  });
});
