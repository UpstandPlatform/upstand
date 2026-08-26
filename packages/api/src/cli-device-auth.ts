import { createHash, randomBytes } from "node:crypto";
import {
  API_KEY_CONFIG_ID,
  API_KEY_PRESETS,
  type ApiKeyPreset,
  apiKeyPermissionsToStatements,
} from "@upstand/domain";
import {
  decryptSecret,
  encryptSecret,
} from "@upstand/platform/crypto/secret-box";
import type { Redis } from "@upstand/redis";
import { redisKey } from "@upstand/redis/utils";

export const CLI_DEVICE_CLIENT_ID = "upstand-cli" as const;
export const CLI_DEVICE_AUTH_TTL_SECONDS = 10 * 60;
export const CLI_DEVICE_POLL_INTERVAL_SECONDS = 5;

const DEVICE_CODE_BYTES = 32;
const USER_CODE_BYTES = 5;
const DEVICE_KEY_PREFIX = "upstand:cli-device";

export type CliDeviceStatus = "pending" | "claiming" | "approved" | "denied";

export type CliDeviceState = {
  clientId: typeof CLI_DEVICE_CLIENT_ID;
  userCode: string;
  status: CliDeviceStatus;
  userId?: string;
  organizationId?: string;
  preset?: ApiKeyPreset;
  createdAt: string;
};

export type CliDeviceAuthorization = {
  deviceCode: string;
  userCode: string;
};

export type CliDevicePollResult =
  | { status: "authorization_pending" }
  | { status: "access_denied" }
  | { status: "expired_token" }
  | {
      status: "approved";
      accessToken: string;
      organizationId: string;
      tokenType: "Bearer";
    };

type RedisDeviceStore = Pick<Redis, "del" | "eval" | "get" | "set">;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deviceKey(deviceCode: string): string {
  return redisKey(DEVICE_KEY_PREFIX, "request", digest(deviceCode));
}

function userCodeIndexKey(userCode: string): string {
  return redisKey(DEVICE_KEY_PREFIX, "user", digest(userCode));
}

function normalizeUserCode(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function createUserCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(USER_CODE_BYTES);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function createCliDeviceAuthorization(): CliDeviceAuthorization {
  return {
    deviceCode: randomBytes(DEVICE_CODE_BYTES).toString("base64url"),
    userCode: createUserCode(),
  };
}

export function cliDeviceUserCode(value: string): string {
  return normalizeUserCode(value);
}

export class CliDeviceAuthStore {
  constructor(private readonly store: RedisDeviceStore) {}

  async create(authorization: CliDeviceAuthorization): Promise<CliDeviceState> {
    const state: CliDeviceState = {
      clientId: CLI_DEVICE_CLIENT_ID,
      userCode: authorization.userCode,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await this.store.set(
      deviceKey(authorization.deviceCode),
      JSON.stringify(state),
      "EX",
      CLI_DEVICE_AUTH_TTL_SECONDS,
    );
    await this.store.set(
      userCodeIndexKey(authorization.userCode),
      digest(authorization.deviceCode),
      "EX",
      CLI_DEVICE_AUTH_TTL_SECONDS,
    );
    return state;
  }

  async getByDeviceCode(deviceCode: string): Promise<CliDeviceState | null> {
    const value = await this.store.get(deviceKey(deviceCode));
    if (!value) return null;
    try {
      return JSON.parse(value) as CliDeviceState;
    } catch {
      return null;
    }
  }

  async approve(input: {
    userCode: string;
    userId: string;
    organizationId: string;
    preset: ApiKeyPreset;
    accessToken: string;
  }): Promise<boolean> {
    if (!(await this.claim(input))) return false;
    const approved = await this.completeApproval(input);
    if (!approved) await this.releaseClaim(input);
    return approved;
  }

  async claim(input: {
    userCode: string;
    userId: string;
    organizationId: string;
    preset: ApiKeyPreset;
  }): Promise<boolean> {
    const normalizedUserCode = normalizeUserCode(input.userCode);
    const deviceDigest = await this.store.get(
      userCodeIndexKey(normalizedUserCode),
    );
    if (!deviceDigest) return false;

    const key = redisKey(DEVICE_KEY_PREFIX, "request", deviceDigest);
    const current = await this.store.get(key);
    if (!current) return false;

    let state: CliDeviceState;
    try {
      state = JSON.parse(current) as CliDeviceState;
    } catch {
      return false;
    }
    if (state.status !== "pending" || state.userCode !== normalizedUserCode) {
      return false;
    }

    const claimingState = JSON.stringify({
      ...state,
      status: "claiming",
      userId: input.userId,
      organizationId: input.organizationId,
      preset: input.preset,
    } satisfies CliDeviceState);
    const result = await this.store.eval(
      `local current = redis.call("GET", KEYS[1])
if not current then return 0 end
local state = cjson.decode(current)
if state.status ~= "pending" or state.userCode ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])
return 1`,
      1,
      key,
      normalizedUserCode,
      claimingState,
      String(CLI_DEVICE_AUTH_TTL_SECONDS),
    );
    return Number(result) === 1;
  }

  async completeApproval(input: {
    userCode: string;
    userId: string;
    organizationId: string;
    preset: ApiKeyPreset;
    accessToken: string;
  }): Promise<boolean> {
    const normalizedUserCode = normalizeUserCode(input.userCode);
    const deviceDigest = await this.store.get(
      userCodeIndexKey(normalizedUserCode),
    );
    if (!deviceDigest) return false;

    const key = redisKey(DEVICE_KEY_PREFIX, "request", deviceDigest);
    const current = await this.store.get(key);
    if (!current) return false;
    let state: CliDeviceState;
    try {
      state = JSON.parse(current) as CliDeviceState;
    } catch {
      return false;
    }
    if (
      state.status !== "claiming" ||
      state.userCode !== normalizedUserCode ||
      state.userId !== input.userId ||
      state.organizationId !== input.organizationId ||
      state.preset !== input.preset
    ) {
      return false;
    }

    const approvedState = JSON.stringify({
      ...state,
      status: "approved",
    } satisfies CliDeviceState);
    const result = await this.store.eval(
      `local current = redis.call("GET", KEYS[1])
if not current then return 0 end
local state = cjson.decode(current)
if state.status ~= "claiming" or state.userCode ~= ARGV[1] or state.userId ~= ARGV[2] then return 0 end
redis.call("SET", KEYS[2], ARGV[3], "EX", ARGV[4])
redis.call("SET", KEYS[1], ARGV[5], "EX", ARGV[4])
return 1`,
      2,
      key,
      redisKey(DEVICE_KEY_PREFIX, "secret", deviceDigest),
      normalizedUserCode,
      input.userId,
      JSON.stringify(encryptSecret(input.accessToken)),
      String(CLI_DEVICE_AUTH_TTL_SECONDS),
      approvedState,
    );
    return Number(result) === 1;
  }

  async releaseClaim(input: {
    userCode: string;
    userId: string;
  }): Promise<boolean> {
    const normalizedUserCode = normalizeUserCode(input.userCode);
    const deviceDigest = await this.store.get(
      userCodeIndexKey(normalizedUserCode),
    );
    if (!deviceDigest) return false;

    const key = redisKey(DEVICE_KEY_PREFIX, "request", deviceDigest);
    const current = await this.store.get(key);
    if (!current) return false;
    let state: CliDeviceState;
    try {
      state = JSON.parse(current) as CliDeviceState;
    } catch {
      return false;
    }
    if (
      state.status !== "claiming" ||
      state.userCode !== normalizedUserCode ||
      state.userId !== input.userId
    ) {
      return false;
    }
    const pendingState: CliDeviceState = {
      clientId: state.clientId,
      userCode: state.userCode,
      status: "pending",
      createdAt: state.createdAt,
    };
    const result = await this.store.eval(
      `local current = redis.call("GET", KEYS[1])
if not current then return 0 end
local state = cjson.decode(current)
if state.status ~= "claiming" or state.userCode ~= ARGV[1] or state.userId ~= ARGV[2] then return 0 end
redis.call("SET", KEYS[1], ARGV[3], "EX", ARGV[4])
return 1`,
      1,
      key,
      normalizedUserCode,
      input.userId,
      JSON.stringify(pendingState),
      String(CLI_DEVICE_AUTH_TTL_SECONDS),
    );
    return Number(result) === 1;
  }

  async deny(userCode: string): Promise<boolean> {
    const normalizedUserCode = normalizeUserCode(userCode);
    const deviceDigest = await this.store.get(
      userCodeIndexKey(normalizedUserCode),
    );
    if (!deviceDigest) return false;
    const key = redisKey(DEVICE_KEY_PREFIX, "request", deviceDigest);
    const current = await this.store.get(key);
    if (!current) return false;
    try {
      const state = JSON.parse(current) as CliDeviceState;
      if (state.status !== "pending") return false;
      await this.store.set(
        key,
        JSON.stringify({ ...state, status: "denied" } satisfies CliDeviceState),
        "EX",
        CLI_DEVICE_AUTH_TTL_SECONDS,
      );
      return true;
    } catch {
      return false;
    }
  }

  async poll(deviceCode: string): Promise<CliDevicePollResult> {
    const state = await this.getByDeviceCode(deviceCode);
    if (!state) return { status: "expired_token" };
    if (state.status === "pending" || state.status === "claiming") {
      return { status: "authorization_pending" };
    }
    if (state.status === "denied") return { status: "access_denied" };
    if (!state.organizationId) return { status: "expired_token" };

    const digestValue = digest(deviceCode);
    const encryptedValue = await this.store.eval(
      `local state = redis.call("GET", KEYS[1])
if not state then return nil end
local decoded = cjson.decode(state)
if decoded.status ~= "approved" then return nil end
local secret = redis.call("GET", KEYS[2])
if not secret then return nil end
redis.call("DEL", KEYS[1], KEYS[2], KEYS[3])
return secret`,
      3,
      redisKey(DEVICE_KEY_PREFIX, "request", digestValue),
      redisKey(DEVICE_KEY_PREFIX, "secret", digestValue),
      userCodeIndexKey(state.userCode),
    );
    if (typeof encryptedValue !== "string") {
      return { status: "authorization_pending" };
    }

    try {
      return {
        status: "approved",
        accessToken: decryptSecret(JSON.parse(encryptedValue)),
        organizationId: state.organizationId,
        tokenType: "Bearer",
      };
    } catch {
      return { status: "expired_token" };
    }
  }
}

export function cliDevicePermissions(preset: ApiKeyPreset) {
  return apiKeyPermissionsToStatements(API_KEY_PRESETS[preset]);
}

export { API_KEY_CONFIG_ID };
