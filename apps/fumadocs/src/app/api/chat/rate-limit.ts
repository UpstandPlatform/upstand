import { createHash } from "node:crypto";
import type { Redis } from "@upstand/redis";

export const CHAT_RATE_LIMIT_MAX_REQUESTS = 20;
export const CHAT_RATE_LIMIT_MAX_TOTAL_REQUESTS = 200;
export const CHAT_RATE_LIMIT_WINDOW_SECONDS = 60;

const CHAT_RATE_LIMIT_SCRIPT = `
local clientCount = redis.call("INCR", KEYS[1])
if clientCount == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local globalCount = redis.call("INCR", KEYS[2])
if globalCount == 1 then
  redis.call("EXPIRE", KEYS[2], ARGV[1])
end
local clientTtl = redis.call("TTL", KEYS[1])
local globalTtl = redis.call("TTL", KEYS[2])
return { clientCount, clientTtl, globalCount, globalTtl }
`;

let chatRedis: Redis | undefined;

async function getChatRedis(): Promise<Redis> {
  if (!chatRedis) {
    const { createRedis } = await import("@upstand/redis");
    chatRedis = createRedis({ loggerName: "fumadocs-chat-rate-limit" });
  }
  return chatRedis;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(`Redis operation timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export type ChatRateLimitResult = {
  allowed: boolean;
  count: number;
  remaining: number;
  resetAfterSeconds: number;
};

function resolveClientIdentity(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
  const realIp = request.headers.get("x-real-ip");
  const value = (forwarded ?? realIp ?? "unknown").trim().slice(0, 128);
  return value || "unknown";
}

function rateLimitKey(request: Request): string {
  const identity = resolveClientIdentity(request);
  const digest = createHash("sha256").update(identity).digest("hex");
  return `fumadocs:chat:ratelimit:${digest}`;
}

const globalRateLimitKey = "fumadocs:chat:ratelimit:global";

export async function enforceChatRateLimit(
  request: Request,
  client?: Pick<Redis, "eval">,
): Promise<ChatRateLimitResult> {
  const resolvedClient = client ?? (await getChatRedis());
  const rawResult: unknown = await withTimeout(
    resolvedClient.eval(
      CHAT_RATE_LIMIT_SCRIPT,
      2,
      rateLimitKey(request),
      globalRateLimitKey,
      String(CHAT_RATE_LIMIT_WINDOW_SECONDS),
    ),
    1_000,
  );
  if (!Array.isArray(rawResult) || rawResult.length < 4) {
    throw new Error(
      "Documentation chat rate limiter returned an invalid result",
    );
  }

  const count = Number(rawResult[0]);
  const resetAfterSeconds = Math.max(1, Number(rawResult[1]));
  const totalCount = Number(rawResult[2]);
  const totalResetAfterSeconds = Math.max(1, Number(rawResult[3]));
  if (
    !Number.isSafeInteger(count) ||
    !Number.isFinite(resetAfterSeconds) ||
    !Number.isSafeInteger(totalCount) ||
    !Number.isFinite(totalResetAfterSeconds)
  ) {
    throw new Error(
      "Documentation chat rate limiter returned invalid counters",
    );
  }

  return {
    allowed:
      count <= CHAT_RATE_LIMIT_MAX_REQUESTS &&
      totalCount <= CHAT_RATE_LIMIT_MAX_TOTAL_REQUESTS,
    count,
    remaining: Math.max(
      0,
      Math.min(
        CHAT_RATE_LIMIT_MAX_REQUESTS - count,
        CHAT_RATE_LIMIT_MAX_TOTAL_REQUESTS - totalCount,
      ),
    ),
    resetAfterSeconds: Math.max(resetAfterSeconds, totalResetAfterSeconds),
  };
}
