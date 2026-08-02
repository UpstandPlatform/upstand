import { describe, expect, test } from "bun:test";
import { resolveRedisPassword } from "./web-server.shared";

describe("Redis maintenance credential resolution", () => {
  test("uses the secret-backed server runtime password before legacy service env", () => {
    expect(
      resolveRedisPassword("runtime-secret", ["REDIS_PASSWORD=old-secret"]),
    ).toBe("runtime-secret");
  });

  test("retains compatibility with legacy service environment inspection", () => {
    expect(
      resolveRedisPassword(undefined, ["REDIS_PASSWORD=legacy-secret"]),
    ).toBe("legacy-secret");
  });

  test("fails closed when no Redis password is available", () => {
    expect(() => resolveRedisPassword(undefined, [])).toThrow(
      "Redis password is not configured on the service",
    );
  });
});
