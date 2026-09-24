import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mockUnitOfWork } from "../testing/mock-unit-of-work";
import { GetQueueUseCase } from "./get-queue.usecase";

const addedAt = new Date("2026-01-01T00:00:00.000Z");

function createUow() {
  return mockUnitOfWork({
    serverBuildSettingsRepository: { findMany: async () => [] },
    resourceRepository: {
      lockById: async () => true,
      findSummariesByIds: async () => [
        {
          id: "resource-1",
          name: "api",
          type: "application",
          serverId: "server-remote",
        },
      ],
    },
    deploymentRepository: {
      findRecentByResourceIds: async () => [
        {
          id: "deployment-running",
          resourceId: "resource-1",
          title: "Manual deployment",
          status: "running",
          serverId: "server-remote",
          serverName: "Remote Node",
          createdAt: addedAt,
        },
        {
          id: "deployment-done",
          resourceId: "resource-1",
          title: "Older deployment",
          status: "success",
          serverId: "server-remote",
          serverName: "Remote Node",
          createdAt: addedAt,
        },
      ],
    },
  });
}

describe("GetQueueUseCase without a queue backend", () => {
  const previousPlatform = process.env.UPSTAND_PLATFORM;

  beforeEach(() => {
    process.env.UPSTAND_PLATFORM = "desktop";
  });

  afterEach(() => {
    if (previousPlatform === undefined) {
      delete process.env.UPSTAND_PLATFORM;
    } else {
      process.env.UPSTAND_PLATFORM = previousPlatform;
    }
  });

  test("reports the in-flight deployment from durable state instead of an empty queue", async () => {
    const jobs = await new GetQueueUseCase(createUow()).execute(["resource-1"]);

    expect(jobs).toEqual([
      {
        id: "deployment-running",
        deploymentId: "deployment-running",
        label: "Manual deployment",
        type: "application",
        state: "active",
        addedAt: addedAt.toISOString(),
        processedAt: null,
        finishedAt: null,
        error: null,
        resourceId: "resource-1",
        resourceName: "api",
        serverId: "server-remote",
        serverName: "Remote Node",
      },
    ]);
  });
});
