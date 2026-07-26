import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { UpdateWebServerBackupScheduleUseCase } from "./update-web-server-backup-schedule.usecase";
import { CreateWebServerBackupScheduleUseCase } from "./web-server-backup.usecase";

function makeUow(destinationOrganizationId = "org-1") {
  const created: Record<string, unknown>[] = [];
  const repository = {
    create: async (input: Record<string, unknown>) => {
      created.push(input);
      return {
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
  };
  const uow = {
    s3DestinationRepository: {
      findById: async () => ({
        id: "destination-1",
        organizationId: destinationOrganizationId,
      }),
    },
    backupScheduleRepository: {
      findById: async (_id: string): Promise<unknown> => null,
      updateById: async (
        _id: string,
        _input: Record<string, unknown>,
      ): Promise<unknown> => null,
    },
    transaction: async (work: (value: never) => Promise<unknown>) =>
      work({ backupScheduleRepository: repository } as never),
  };
  return { created, uow };
}

describe("web-server backup schedules", () => {
  test("creates an organization-owned global schedule without a resource", async () => {
    const { uow, created } = makeUow();
    const schedule = await new CreateWebServerBackupScheduleUseCase(
      uow as unknown as IUnitOfWork,
    ).execute({
      organizationId: "org-1",
      destinationId: "destination-1",
      name: "Nightly platform",
      cronExpression: "0 3 * * *",
      timezone: "UTC",
      prefix: "platform",
      enabled: true,
    });

    expect(created[0]).toMatchObject({
      organizationId: "org-1",
      resourceId: null,
      kind: "web-server",
    });
    expect(schedule.kind).toBe("web-server");
    expect(schedule.resourceId).toBeNull();
  });

  test("rejects a destination from another organization", async () => {
    const { uow } = makeUow("org-2");
    await expect(
      new CreateWebServerBackupScheduleUseCase(
        uow as unknown as IUnitOfWork,
      ).execute({
        organizationId: "org-1",
        destinationId: "destination-1",
        name: "Nightly platform",
        cronExpression: "0 3 * * *",
        timezone: "UTC",
        prefix: "platform",
        enabled: true,
      }),
    ).rejects.toThrow("another organization");
  });

  test("allows retention to be cleared during an update", async () => {
    const updates: Record<string, unknown>[] = [];
    const existing = {
      id: "schedule-1",
      organizationId: "org-1",
      resourceId: null,
      destinationId: "destination-1",
      name: "Nightly platform",
      kind: "web-server",
      cronExpression: "0 3 * * *",
      timezone: "UTC",
      prefix: "platform",
      retentionCount: 7,
      enabled: true,
      databaseName: null,
      databaseEngine: null,
      serviceName: null,
      volumeName: null,
      stopService: false,
      encryptedConfiguration: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { uow } = makeUow();
    uow.backupScheduleRepository = {
      findById: async () => existing,
      updateById: async (_id: string, input: Record<string, unknown>) => {
        updates.push(input);
        return { ...existing, ...input, updatedAt: new Date() };
      },
    };

    await new UpdateWebServerBackupScheduleUseCase(
      uow as unknown as IUnitOfWork,
    ).execute({
      id: existing.id,
      organizationId: existing.organizationId,
      retentionCount: null,
    });

    expect(updates[0]).toMatchObject({ retentionCount: null });
  });
});
