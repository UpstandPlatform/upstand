import { describe, expect, test } from "bun:test";
import type { BackupRun } from "@upstand/domain";
import { VerifyBackupRunUseCase } from "./verify-backup-run.usecase";

const run: BackupRun = {
  id: "run-1",
  scheduleId: "schedule-1",
  resourceId: null,
  organizationId: "organization-1",
  destinationId: "destination-1",
  kind: "web-server",
  status: "succeeded",
  fileKey: "backups/run-1/manifest.json",
  error: null,
  startedAt: new Date(Date.now() - 5_000),
  completedAt: new Date(Date.now() - 1_000),
  createdAt: new Date(),
  updatedAt: new Date(),
  verificationStatus: null,
  verifiedAt: null,
  restoreTestedAt: null,
  recoveryPoint: null,
};

function createUseCase(
  verifyBackup: () => Promise<void>,
  runValue: BackupRun | null = run,
) {
  const updates: Record<string, unknown>[] = [];
  const uow = {
    backupRunRepository: {
      findById: async () => runValue,
      updateById: async (_id: string, patch: Record<string, unknown>) => {
        updates.push(patch);
        return { ...run, ...patch };
      },
    },
    backupScheduleRepository: {
      findById: async () => ({ kind: "web-server" }),
    },
    s3DestinationRepository: {
      findById: async () => ({ id: "destination-1" }),
    },
  };
  const runtime = { verifyBackup };
  return {
    useCase: new VerifyBackupRunUseCase(uow as never, runtime as never),
    updates,
  };
}

describe("VerifyBackupRunUseCase", () => {
  test("marks a successfully verified web-server artifact and records its recovery point", async () => {
    const { useCase, updates } = createUseCase(async () => undefined);

    const result = await useCase.execute(run.id);

    expect(result.verificationStatus).toBe("verified");
    expect(result.restoreTestedAt).toBeInstanceOf(Date);
    expect(result.recoveryPoint).toBe(run.completedAt?.toISOString() ?? null);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ verificationStatus: "verified" });
  });

  test("records a failed verification before propagating the verifier error", async () => {
    const { useCase, updates } = createUseCase(async () => {
      throw new Error("manifest checksum mismatch");
    });

    await expect(useCase.execute(run.id)).rejects.toThrow(
      "manifest checksum mismatch",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      verificationStatus: "failed",
      error: "manifest checksum mismatch",
    });
  });

  test("rejects incomplete runs before loading backup configuration", async () => {
    const incomplete = {
      ...run,
      status: "running",
      fileKey: null,
    } as BackupRun;
    const { useCase, updates } = createUseCase(
      async () => undefined,
      incomplete,
    );

    await expect(useCase.execute(incomplete.id)).rejects.toThrow(
      "Completed backup artifact not found",
    );
    expect(updates).toEqual([]);
  });
});
