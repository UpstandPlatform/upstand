import { describe, expect, test } from "bun:test";
import { resolveRedisPassword } from "./web-server.shared";

describe("Redis maintenance credential resolution", () => {
  test("uses the secret-backed server runtime password", () => {
    expect(resolveRedisPassword("runtime-secret")).toBe("runtime-secret");
  });

  test("fails closed when no Redis password is available", () => {
    expect(() => resolveRedisPassword(undefined)).toThrow(
      "Redis password is not configured in the runtime",
    );
  });
});
