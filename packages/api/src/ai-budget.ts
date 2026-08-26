export interface RedisScriptClient {
  eval(
    script: string,
    numberOfKeys: number,
    ...argumentsList: string[]
  ): Promise<unknown>;
}

const INCREMENT_DAILY_BUDGET_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

const RESERVE_DAILY_TOKEN_AND_COST_BUDGET_SCRIPT = `
local requestedTokens = tonumber(ARGV[1])
local tokenLimit = tonumber(ARGV[2])
local requestedCents = tonumber(ARGV[3])
local costLimit = tonumber(ARGV[4])
if not requestedTokens or not tokenLimit or not requestedCents or not costLimit or requestedTokens < 1 or tokenLimit < 1 or requestedCents < 1 or costLimit < 1 then
  return -1
end
local currentTokens = tonumber(redis.call("GET", KEYS[1]) or "0")
local currentCents = tonumber(redis.call("GET", KEYS[2]) or "0")
if currentTokens + requestedTokens > tokenLimit or currentCents + requestedCents > costLimit then
  return 0
end
local totalTokens = redis.call("INCRBY", KEYS[1], requestedTokens)
local totalCents = redis.call("INCRBY", KEYS[2], requestedCents)
if totalTokens == requestedTokens then
  redis.call("EXPIRE", KEYS[1], ARGV[5])
end
if totalCents == requestedCents then
  redis.call("EXPIRE", KEYS[2], ARGV[5])
end
return { totalTokens, totalCents }
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
 * Reserve the token and cost ceilings in one Redis transaction. Both keys are
 * checked before either is incremented, so a rejected cost reservation cannot
 * consume token quota without admitting a model call.
 */
export async function reserveUpGalDailyTokenAndCostBudget(
  client: RedisScriptClient,
  organizationId: string,
  requestedTokens: number,
  tokenLimit: number,
  requestedCents: number,
  costLimitCents: number,
  now = new Date(),
): Promise<{
  totalTokens: number;
  tokenLimit: number;
  totalCents: number;
  costLimitCents: number;
} | null> {
  if (
    !Number.isSafeInteger(requestedTokens) ||
    requestedTokens < 1 ||
    !Number.isSafeInteger(tokenLimit) ||
    tokenLimit < 1 ||
    !Number.isSafeInteger(requestedCents) ||
    requestedCents < 1 ||
    !Number.isSafeInteger(costLimitCents) ||
    costLimitCents < 1
  ) {
    throw new Error(
      "UpGal token and cost budget values must be positive safe integers",
    );
  }
  const result = await client.eval(
    RESERVE_DAILY_TOKEN_AND_COST_BUDGET_SCRIPT,
    2,
    upGalDailyTokenBudgetKey(organizationId, now),
    upGalDailyCostBudgetKey(organizationId, now),
    String(requestedTokens),
    String(tokenLimit),
    String(requestedCents),
    String(costLimitCents),
    String(secondsUntilNextUtcDay(now)),
  );
  if (result === 0) return null;
  if (!Array.isArray(result) || result.length !== 2) {
    throw new Error(
      "Redis returned an invalid UpGal token and cost reservation",
    );
  }
  const totalTokens = Number(result[0]);
  const totalCents = Number(result[1]);
  if (
    !Number.isSafeInteger(totalTokens) ||
    totalTokens < requestedTokens ||
    !Number.isSafeInteger(totalCents) ||
    totalCents < requestedCents
  ) {
    throw new Error(
      "Redis returned an invalid UpGal token and cost reservation",
    );
  }
  return { totalTokens, tokenLimit, totalCents, costLimitCents };
}
