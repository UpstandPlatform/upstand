import { describe, expect, test } from "bun:test";
import type { Resource } from "@upstand/domain";
import { RunDatabaseMigrationUseCase } from "./database-operations.usecases";

const resource = {
  id: "database-1",
  type: "database",
  name: "Postgres",
  environmentId: "environment-1",
  provider: "postgres",
  status: "running",
  buildConfig: "{}",
  envVars: "{}",
  domains: "[]",
  createdAt: new Date(),
  updatedAt: new Date(),
} as Resource;

function createUseCase(options?: {
  runs?: Array<{
    status: string;
    verificationStatus: string | null;
    completedAt: Date | null;
  }>;
  output?: string;
}) {
  const calls: string[] = [];
  const uow = {
    resourceRepository: {
      findById: async (id: string) => (id === resource.id ? resource : null),
    },
    backupRunRepository: {
      findByResourceId: async () => options?.runs ?? [],
    },
  };
  const docker = {
    runCommandInResourceContainer: async (
      _resource: Resource,
      command: string,
    ) => {
      calls.push(command);
      return options?.output ?? "migration complete";
    },
  };

  return {
    useCase: new RunDatabaseMigrationUseCase(uow as never, docker),
    calls,
  };
}

describe("RunDatabaseMigrationUseCase", () => {
  test("requires a recent verified backup by default", async () => {
    const { useCase, calls } = createUseCase({
      runs: [
        {
          status: "succeeded",
          verificationStatus: "verified",
          completedAt: new Date(Date.now() - 24 * 60 * 60 * 1000 - 1_000),
        },
        {
          status: "succeeded",
          verificationStatus: "failed",
          completedAt: new Date(),
        },
      ],
    });

    await expect(
      useCase.execute({
        resourceId: resource.id,
        command: "ALTER TABLE users ADD COLUMN active boolean",
        requireRecentBackup: true,
      }),
    ).rejects.toThrow("verified backup from the last 24 hours is required");
    expect(calls).toEqual([]);
  });

  test("executes only for database resources and wraps the command in a shell", async () => {
    const { useCase, calls } = createUseCase({
      runs: [
        {
          status: "succeeded",
          verificationStatus: "verified",
          completedAt: new Date(),
        },
      ],
    });

    await expect(
      useCase.execute({
        resourceId: resource.id,
        command: "echo 'migration; safe'",
        requireRecentBackup: true,
      }),
    ).resolves.toEqual({ output: "migration complete" });
    expect(calls).toEqual([
      `sh -ec ${JSON.stringify("echo 'migration; safe'")}`,
    ]);
  });

  test("can bypass the backup gate explicitly and bounds command output", async () => {
    const output = "x".repeat(50_500);
    const { useCase, calls } = createUseCase({ output });

    const result = await useCase.execute({
      resourceId: resource.id,
      command: "echo migration",
      requireRecentBackup: false,
    });

    expect(result.output).toHaveLength(50_000);
    expect(calls).toHaveLength(1);
  });
});
