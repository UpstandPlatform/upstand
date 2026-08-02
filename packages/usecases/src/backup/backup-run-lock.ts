import { type Redis, redis } from "@upstand/redis";

export const BACKUP_LOCK_TTL_MS = 6 * 60 * 60 * 1_000;
const BACKUP_LOCK_OPERATION_TIMEOUT_MS = 2_000;

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

type BackupLockRedis = Pick<Redis, "set" | "eval">;

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Backup lock Redis operation timed out")),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function backupRunLockKey(scheduleId: string): string {
  return `upstand:backup:run:${scheduleId}`;
}

export async function acquireBackupRunLock(
  scheduleId: string,
  runId: string,
  client: BackupLockRedis = redis,
): Promise<boolean> {
  const acquired = await withTimeout(
    client.set(
      backupRunLockKey(scheduleId),
      runId,
      "PX",
      BACKUP_LOCK_TTL_MS,
      "NX",
    ),
    BACKUP_LOCK_OPERATION_TIMEOUT_MS,
  );
  return acquired === "OK";
}

export async function renewBackupRunLock(
  scheduleId: string,
  runId: string,
  client: BackupLockRedis = redis,
): Promise<boolean> {
  const renewed = await withTimeout(
    client.eval(
      COMPARE_AND_RENEW,
      1,
      backupRunLockKey(scheduleId),
      runId,
      String(BACKUP_LOCK_TTL_MS),
    ),
    BACKUP_LOCK_OPERATION_TIMEOUT_MS,
  );
  return Number(renewed) === 1;
}

export async function ensureBackupRunLock(
  scheduleId: string,
  runId: string,
  client: BackupLockRedis = redis,
): Promise<boolean> {
  if (await renewBackupRunLock(scheduleId, runId, client)) return true;
  return acquireBackupRunLock(scheduleId, runId, client);
}

export async function releaseBackupRunLock(
  scheduleId: string,
  runId: string,
  client: BackupLockRedis = redis,
): Promise<void> {
  await withTimeout(
    client.eval(COMPARE_AND_DELETE, 1, backupRunLockKey(scheduleId), runId),
    BACKUP_LOCK_OPERATION_TIMEOUT_MS,
  );
}
