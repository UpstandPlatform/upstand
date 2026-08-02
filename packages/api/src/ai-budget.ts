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

export function upGalDailyBudgetKey(
  organizationId: string,
  now = new Date(),
): string {
  return `upgal:daily-runs:${organizationId}:${now.toISOString().slice(0, 10)}`;
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
