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

  async eval(script: string, numberOfKeys: number, ...args: string[]) {
    if (numberOfKeys === 1) {
      const [requestKey, userCode, state] = args;
      const current = requestKey ? this.values.get(requestKey) : undefined;
      if (!requestKey || !userCode || !state || !current) return 0;
      const parsed = JSON.parse(current) as {
        status?: string;
        userCode?: string;
        userId?: string;
      };
      if (args.length === 4) {
        if (parsed.status !== "pending" || parsed.userCode !== userCode)
          return 0;
        this.values.set(requestKey, state);
      } else {
        const pendingState = args[3];
        if (
          !pendingState ||
          parsed.status !== "claiming" ||
          parsed.userCode !== userCode ||
          parsed.userId !== state
        )
          return 0;
        this.values.set(requestKey, pendingState);
      }
      return 1;
    }
    if (numberOfKeys === 2 && script.includes("KEYS[2], ARGV[3]")) {
      const [requestKey, secretKey, userCode, userId, encrypted, _ttl, state] =
        args;
      const current = requestKey ? this.values.get(requestKey) : undefined;
      if (
        !requestKey ||
        !secretKey ||
        !userCode ||
        !userId ||
        !encrypted ||
        !state ||
        !current
      )
        return 0;
      const parsed = JSON.parse(current) as {
        status?: string;
        userCode?: string;
        userId?: string;
      };
      if (
        parsed.status !== "claiming" ||
        parsed.userCode !== userCode ||
        parsed.userId !== userId
      )
        return 0;
      this.values.set(secretKey, encrypted);
      this.values.set(requestKey, state);
      return 1;
    }
    if (numberOfKeys === 3) {
      const [requestKey, secretKey, _userCode] = args;
      const encrypted = secretKey ? this.values.get(secretKey) : undefined;
      if (!requestKey || !secretKey || !encrypted) return null;
      this.values.delete(requestKey);
      this.values.delete(secretKey);
      return encrypted;
    }
    return null;
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

  test("claims before key creation and keeps polling pending until completion", async () => {
    const redis = new MemoryRedis();
    const store = new CliDeviceAuthStore(redis as never);
    const authorization = createCliDeviceAuthorization();
    await store.create(authorization);

    const input = {
      userCode: authorization.userCode,
      userId: "user-1",
      organizationId: "org-1",
      preset: "deployment" as const,
    };
    expect(await store.claim(input)).toBe(true);
    expect(await store.poll(authorization.deviceCode)).toEqual({
      status: "authorization_pending",
    });
    expect(
      await store.completeApproval({ ...input, accessToken: "upk_secret" }),
    ).toBe(true);
    expect(await store.poll(authorization.deviceCode)).toMatchObject({
      status: "approved",
      organizationId: "org-1",
      tokenType: "Bearer",
    });
  });
});
