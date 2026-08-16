import { describe, expect, test } from "bun:test";
import type { BackupRun, IBackupRunRepository } from "@upstand/domain";
import {
  BACKUP_RUN_PAGE_SIZE,
  forEachBackupRunBySchedule,
} from "./backup-run-pagination";

function run(id: string, offset: number): BackupRun {
  const createdAt = new Date(1_700_000_000_000 - offset * 1_000);
  return {
    id,
    scheduleId: "schedule-1",
    resourceId: null,
    organizationId: "org-1",
    destinationId: "destination-1",
    kind: "database",
    status: "succeeded",
    fileKey: `backup/${id}`,
    error: null,
    startedAt: createdAt,
    completedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    verificationStatus: "verified",
    verifiedAt: createdAt,
    restoreTestedAt: createdAt,
    recoveryPoint: createdAt.toISOString(),
  };
}

describe("backup run pagination", () => {
  test("walks every cursor page in order without loading all runs at once", async () => {
    const firstPage = Array.from({ length: BACKUP_RUN_PAGE_SIZE }, (_, i) =>
      run(`run-${i}`, i),
    );
    const secondPage = [run("run-last", BACKUP_RUN_PAGE_SIZE)];
    const calls: Array<{ cursor?: { id: string }; limit?: number }> = [];
    const repository = {
      findByScheduleIdPage: async (
        _scheduleId: string,
        options: { cursor?: { id: string }; limit?: number } = {},
      ) => {
        calls.push(options);
        return options.cursor ? secondPage : firstPage;
      },
    } as unknown as IBackupRunRepository;
    const visited: string[] = [];

    await forEachBackupRunBySchedule(repository, "schedule-1", (item) => {
      visited.push(item.id);
    });

    expect(visited).toHaveLength(BACKUP_RUN_PAGE_SIZE + 1);
    expect(visited[0]).toBe("run-0");
    expect(visited.at(-1)).toBe("run-last");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.limit).toBe(BACKUP_RUN_PAGE_SIZE);
    expect(calls[1]?.cursor?.id).toBe("run-499");
  });
});
