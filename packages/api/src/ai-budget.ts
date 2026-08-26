export interface RedisScriptClient {
  eval(
    script: string,
    numberOfKeys: number,
    ...argumentsList: string[]
  ): Promise<unknown>;
}

export type UpGalTokenBudgetReservation = {
  totalTokens: number;
  limit: number;
};

export type UpGalCostBudgetReservation = {
  totalCents: number;
  limitCents: number;
};

const INCREMENT_DAILY_BUDGET_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

const RESERVE_DAILY_TOKEN_BUDGET_SCRIPT = `
local requested = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
if not requested or not limit or requested < 1 or limit < 1 then
  return -1
end
if current + requested > limit then
  return 0
end
local total = redis.call("INCRBY", KEYS[1], requested)
if total == requested then
  redis.call("EXPIRE", KEYS[1], ARGV[3])
end
return total
`;

export function upGalDailyBudgetKey(
  organizationId: string,
  now = new Date(),
): string {
  return `upgal:daily-runs:${organizationId}:${now.toISOString().slice(0, 10)}`;
}

export function upGalDailyTokenBudgetKey(
  organizationId: string,
  now = new Date(),
): string {
  return `upgal:daily-tokens:${organizationId}:${now.toISOString().slice(0, 10)}`;
}

export function upGalDailyCostBudgetKey(
  organizationId: string,
  now = new Date(),
): string {
  return `upgal:daily-cost-cents:${organizationId}:${now.toISOString().slice(0, 10)}`;
}

export function upGalCostCentsForTokens(
  requestedTokens: number,
  maxCostPerMillionTokensUsd: number,
): number {
  if (
    !Number.isSafeInteger(requestedTokens) ||
    requestedTokens < 1 ||
    !Number.isFinite(maxCostPerMillionTokensUsd) ||
    maxCostPerMillionTokensUsd <= 0
  ) {
    throw new Error("UpGal cost budget values must be positive");
  }
  const cents = Math.ceil(
    (requestedTokens * maxCostPerMillionTokensUsd * 100) / 1_000_000,
  );
  if (!Number.isSafeInteger(cents) || cents < 1) {
    throw new Error(
      "UpGal cost budget calculation exceeded safe integer range",
    );
  }
  return cents;
}

export function secondsUntilNextUtcDay(now = new Date()): number {
  const nextDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return Math.max(1, Math.ceil((nextDay.getTime() - now.getTime()) / 1000));
}

/**
 * Increment a daily budget and install its expiry atomically. Keeping the
 * INCR/EXPIRE pair in one Redis script prevents a failed first EXPIRE from
 * leaving an organization budget key without a TTL forever.
 */
export async function incrementUpGalDailyBudget(
  client: RedisScriptClient,
  organizationId: string,
  now = new Date(),
): Promise<number> {
  const result = await client.eval(
    INCREMENT_DAILY_BUDGET_SCRIPT,
    1,
    upGalDailyBudgetKey(organizationId, now),
    String(secondsUntilNextUtcDay(now)),
  );
  const count = Number(result);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("Redis returned an invalid UpGal budget count");
  }
  return count;
}

/**
 * Reserve the worst-case token ceiling for a request before calling a model.
 * Redis evaluates the limit and increment atomically, so concurrent replicas
 * cannot admit more reserved provider work than the organization budget.
 */
export async function reserveUpGalDailyTokenBudget(
  client: RedisScriptClient,
  organizationId: string,
  requestedTokens: number,
  limit: number,
  now = new Date(),
): Promise<UpGalTokenBudgetReservation | null> {
  if (
    !Number.isSafeInteger(requestedTokens) ||
    requestedTokens < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1
  ) {
    throw new Error("UpGal token budget values must be positive safe integers");
  }
  const result = await client.eval(
    RESERVE_DAILY_TOKEN_BUDGET_SCRIPT,
    1,
    upGalDailyTokenBudgetKey(organizationId, now),
    String(requestedTokens),
    String(limit),
    String(secondsUntilNextUtcDay(now)),
  );
  const totalTokens = Number(result);
  if (totalTokens === 0) return null;
  if (!Number.isSafeInteger(totalTokens) || totalTokens < requestedTokens) {
    throw new Error("Redis returned an invalid UpGal token budget reservation");
  }
  return { totalTokens, limit };
}

/**
 * Reserve a conservative provider-cost ceiling before a model call. The
 * caller supplies a reviewed maximum USD price per million tokens; cents are
 * used so Redis never has to perform floating-point accounting.
 */
export async function reserveUpGalDailyCostBudget(
  client: RedisScriptClient,
  organizationId: string,
  requestedCents: number,
  limitCents: number,
  now = new Date(),
): Promise<UpGalCostBudgetReservation | null> {
  if (
    !Number.isSafeInteger(requestedCents) ||
    requestedCents < 1 ||
    !Number.isSafeInteger(limitCents) ||
    limitCents < 1
  ) {
    throw new Error("UpGal cost budget values must be positive safe integers");
  }
  const result = await client.eval(
    RESERVE_DAILY_TOKEN_BUDGET_SCRIPT,
    1,
    upGalDailyCostBudgetKey(organizationId, now),
    String(requestedCents),
    String(limitCents),
    String(secondsUntilNextUtcDay(now)),
  );
  const totalCents = Number(result);
  if (totalCents === 0) return null;
  if (!Number.isSafeInteger(totalCents) || totalCents < requestedCents) {
    throw new Error("Redis returned an invalid UpGal cost budget reservation");
  }
  return { totalCents, limitCents };
}
