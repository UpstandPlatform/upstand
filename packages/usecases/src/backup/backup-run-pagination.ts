import type {
  BackupRun,
  BackupRunPageCursor,
  IBackupRunRepository,
} from "@upstand/domain";

export const BACKUP_RUN_PAGE_SIZE = 500;
const LEGACY_BACKUP_RUN_READ_LIMIT = 10_000;

/**
 * Visits every run for a schedule without materializing the schedule history
 * in memory. The legacy fallback keeps lightweight test adapters compatible;
 * production repositories implement the cursor-based method.
 */
export async function forEachBackupRunBySchedule(
  repository: IBackupRunRepository,
  scheduleId: string,
  visit: (run: BackupRun) => Promise<void> | void,
): Promise<void> {
  if (!repository.findByScheduleIdPage) {
    const runs = await repository.findByScheduleId(
      scheduleId,
      LEGACY_BACKUP_RUN_READ_LIMIT,
    );
    for (const run of runs) await visit(run);
    return;
  }

  let cursor: BackupRunPageCursor | undefined;
  while (true) {
    const page = await repository.findByScheduleIdPage(scheduleId, {
      cursor,
      limit: BACKUP_RUN_PAGE_SIZE,
    });
    if (page.length === 0) return;

    for (const run of page) await visit(run);

    if (page.length < BACKUP_RUN_PAGE_SIZE) return;
    const last = page[page.length - 1];
    if (!last) return;
    cursor = { createdAt: last.createdAt, id: last.id };
  }
}
