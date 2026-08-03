import { describe, expect, test } from "bun:test";
import {
  CliDeviceAuthStore,
  cliDeviceUserCode,
  createCliDeviceAuthorization,
} from "./cli-device-auth";

class MemoryRedis {
  private readonly values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.values.set(key, value);
    return "OK";
  }

  async del(...keys: string[]) {
    return keys.filter((key) => this.values.delete(key)).length;
  }

  async eval(_script: string, numberOfKeys: number, ...args: string[]) {
    if (numberOfKeys !== 2) return null;
    const [requestKey, secretKey, _userCode, encrypted, _ttl, state] = args;
    if (!requestKey || !secretKey || !encrypted || !state) return 0;
    this.values.set(secretKey, encrypted);
    this.values.set(requestKey, state);
    return 1;
  }
}

describe("CLI device authorization", () => {
  test("creates a one-time user code and starts pending", async () => {
    const redis = new MemoryRedis();
    const store = new CliDeviceAuthStore(redis as never);
    const authorization = createCliDeviceAuthorization();

    await store.create(authorization);

    expect(authorization.deviceCode.length).toBeGreaterThan(32);
    expect(authorization.userCode).toMatch(/^[A-Z2-9]{5}$/);
    expect(await store.poll(authorization.deviceCode)).toEqual({
      status: "authorization_pending",
    });
  });

  test("normalizes user codes and records approval without exposing the secret in state", async () => {
    const redis = new MemoryRedis();
    const store = new CliDeviceAuthStore(redis as never);
    const authorization = createCliDeviceAuthorization();
    await store.create(authorization);

    expect(
      await store.approve({
        userCode: `${authorization.userCode.slice(0, 2)}-${authorization.userCode.slice(2)}`,
        userId: "user-1",
        organizationId: "org-1",
        preset: "deployment",
        accessToken: "upk_secret",
      }),
    ).toBe(true);
    const state = await store.getByDeviceCode(authorization.deviceCode);
    expect(state?.status).toBe("approved");
    expect(state?.organizationId).toBe("org-1");
    expect(JSON.stringify(state)).not.toContain("upk_secret");
    expect(cliDeviceUserCode("ab-cd2")).toBe("ABCD2");
  });
});
