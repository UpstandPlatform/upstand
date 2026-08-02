import { randomUUID } from "node:crypto";
import { withRedisTimeout } from "@upstand/redis";

export interface RedisMcpConnectionClient {
  eval(
    script: string,
    numberOfKeys: number,
    ...argumentsList: string[]
  ): Promise<unknown>;
}

export interface McpConnectionLease {
  renew(): Promise<boolean>;
  release(): Promise<void>;
}

const MCP_CONNECTIONS_KEY = "upstand:mcp:connections:global";
const MCP_CONNECTION_ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[1])
local ttlMs = tonumber(ARGV[2])
local maxConnections = tonumber(ARGV[3])
local maxConnectionsPerKey = tonumber(ARGV[4])
local token = ARGV[5]
local expiresAt = now + ttlMs
local cleanupBefore = now

redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", cleanupBefore)
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", cleanupBefore)

if redis.call("ZCARD", KEYS[1]) >= maxConnections then
  return 0
end
if redis.call("ZCARD", KEYS[2]) >= maxConnectionsPerKey then
  return 0
end

redis.call("ZADD", KEYS[1], expiresAt, token)
redis.call("ZADD", KEYS[2], expiresAt, token)
local zsetTtlSeconds = math.max(2, math.ceil(ttlMs / 1000) + 60)
redis.call("EXPIRE", KEYS[1], zsetTtlSeconds)
redis.call("EXPIRE", KEYS[2], zsetTtlSeconds)
return 1
`;

const MCP_CONNECTIONS_RENEW_SCRIPT = `
local now = tonumber(ARGV[1])
local ttlMs = tonumber(ARGV[2])
local token = ARGV[3]
local expiresAt = now + ttlMs

local currentExpiry = redis.call("ZSCORE", KEYS[1], token)
if not currentExpiry or tonumber(currentExpiry) <= now then
  redis.call("ZREM", KEYS[1], token)
  redis.call("ZREM", KEYS[2], token)
  return 0
end

redis.call("ZADD", KEYS[1], expiresAt, token)
redis.call("ZADD", KEYS[2], expiresAt, token)
local zsetTtlSeconds = math.max(2, math.ceil(ttlMs / 1000) + 60)
redis.call("EXPIRE", KEYS[1], zsetTtlSeconds)
redis.call("EXPIRE", KEYS[2], zsetTtlSeconds)
return 1
`;

const MCP_CONNECTIONS_RELEASE_SCRIPT = `
local token = ARGV[1]
local removed = redis.call("ZREM", KEYS[1], token)
redis.call("ZREM", KEYS[2], token)
return removed
`;

function perKeyMcpConnectionsKey(keyId: string): string {
  return `upstand:mcp:connections:key:${encodeURIComponent(keyId)}`;
}

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

/**
 * Enforces MCP SSE capacity across all server replicas using Redis sorted-set
 * leases. Expiring members prevent crashed workers from holding capacity
 * forever; callers renew while the SSE stream is alive.
 */
export class RedisMcpConnectionLimiter {
  private readonly maxConnections: number;
  private readonly maxConnectionsPerKey: number;
  private readonly leaseTtlMs: number;

  constructor(
    private readonly redis: RedisMcpConnectionClient,
    options: {
      maxConnections?: number;
      maxConnectionsPerKey?: number;
      leaseTtlMs?: number;
    } = {},
  ) {
    this.maxConnections = assertPositiveInteger(
      options.maxConnections ?? 256,
      "maxConnections",
    );
    this.maxConnectionsPerKey = assertPositiveInteger(
      options.maxConnectionsPerKey ?? 8,
      "maxConnectionsPerKey",
    );
    this.leaseTtlMs = assertPositiveInteger(
      options.leaseTtlMs ?? 120_000,
      "leaseTtlMs",
    );
  }

  async acquire(keyId: string): Promise<McpConnectionLease | null> {
    const token = randomUUID();
    const key = perKeyMcpConnectionsKey(keyId);
    const result = await withRedisTimeout(
      this.redis.eval(
        MCP_CONNECTION_ACQUIRE_SCRIPT,
        2,
        MCP_CONNECTIONS_KEY,
        key,
        String(Date.now()),
        String(this.leaseTtlMs),
        String(this.maxConnections),
        String(this.maxConnectionsPerKey),
        token,
      ),
    );
    const acquired = Number(result);
    if (acquired !== 0 && acquired !== 1) {
      throw new Error("Redis returned an invalid MCP connection lease result");
    }
    if (acquired === 0) return null;

    let released = false;
    return {
      renew: async () => {
        if (released) return false;
        const renewed = await withRedisTimeout(
          this.redis.eval(
            MCP_CONNECTIONS_RENEW_SCRIPT,
            2,
            MCP_CONNECTIONS_KEY,
            key,
            String(Date.now()),
            String(this.leaseTtlMs),
            token,
          ),
        );
        const isRenewed = Number(renewed) === 1;
        if (!isRenewed) released = true;
        return isRenewed;
      },
      release: async () => {
        if (released) return;
        released = true;
        await withRedisTimeout(
          this.redis.eval(
            MCP_CONNECTIONS_RELEASE_SCRIPT,
            2,
            MCP_CONNECTIONS_KEY,
            key,
            token,
          ),
        ).catch(() => undefined);
      },
    };
  }
}
