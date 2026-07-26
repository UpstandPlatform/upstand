import { redis } from "@upstand/redis";

export const BACKUP_LOCK_TTL_MS = 6 * 60 * 60 * 1_000;

const COMPARE_AND_DELETE = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const COMPARE_AND_RENEW = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`;

export function backupRunLockKey(scheduleId: string): string {
  return `upstand:backup:run:${scheduleId}`;
}

export async function acquireBackupRunLock(
  scheduleId: string,
  runId: string,
): Promise<boolean> {
  const acquired = await redis.set(
    backupRunLockKey(scheduleId),
    runId,
    "PX",
    BACKUP_LOCK_TTL_MS,
    "NX",
  );
  return acquired === "OK";
}

export async function renewBackupRunLock(
  scheduleId: string,
  runId: string,
): Promise<boolean> {
  const renewed = await redis.eval(
    COMPARE_AND_RENEW,
    1,
    backupRunLockKey(scheduleId),
    runId,
    String(BACKUP_LOCK_TTL_MS),
  );
  return Number(renewed) === 1;
}

export async function releaseBackupRunLock(
  scheduleId: string,
  runId: string,
): Promise<void> {
  await redis.eval(COMPARE_AND_DELETE, 1, backupRunLockKey(scheduleId), runId);
}
