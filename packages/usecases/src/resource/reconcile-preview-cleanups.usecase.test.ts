import { describe, expect, test } from "bun:test";
import type { IUnitOfWork, PreviewDeployment, Resource } from "@upstand/domain";
import type { CaddyServicePort } from "../ports/caddy";
import type { DockerPreviewCleanupPort } from "../ports/docker";
import { ReconcilePreviewCleanupsUseCase } from "./reconcile-preview-cleanups.usecase";

function preview(
  id: string,
  appName: string,
  resourceId = "resource-1",
): PreviewDeployment {
  return {
    id,
    resourceId,
    pullRequestId: 42,
    branchName: "feature/test",
    appName,
    status: "cleanup_pending",
    domain: `${appName}.example.test`,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  };
}

describe("ReconcilePreviewCleanupsUseCase", () => {
  test("cleans a bounded pending batch and deletes only cleaned records", async () => {
    const candidates = [preview("preview-1", "preview-1")];
    const deleted: string[] = [];
    const removed: Array<[string, string]> = [];
    let requestedLimit = 0;
    const resource = { id: "resource-1", serverId: "local" } as Resource;
    const uow = {
      previewDeploymentRepository: {
        findByStatus: async (_status: string, limit: number) => {
          requestedLimit = limit;
          return candidates;
        },
        deleteById: async (id: string) => {
          deleted.push(id);
          return true;
        },
      },
      resourceRepository: { findById: async () => resource },
    } as unknown as IUnitOfWork;
    const cleanupPort: DockerPreviewCleanupPort = {
      removeServiceByName: async (appName, resourceId) => {
        removed.push([appName, resourceId]);
      },
    };

    const result = await new ReconcilePreviewCleanupsUseCase(
      uow,
      cleanupPort,
      {} as CaddyServicePort,
    ).execute({ limit: 10_000 });

    expect(result).toEqual({
      inspected: 1,
      cleaned: 1,
      failed: 0,
      skipped: 0,
      previewIds: ["preview-1"],
    });
    expect(removed).toEqual([["preview-1", "resource-1"]]);
    expect(deleted).toEqual(["preview-1"]);
    expect(requestedLimit).toBe(500);
  });

  test("retains records when the target cleanup fails or the parent is gone", async () => {
    const candidates = [
      preview("preview-1", "preview-1"),
      preview("preview-2", "preview-2", "missing-resource"),
    ];
    const deleted: string[] = [];
    const uow = {
      previewDeploymentRepository: {
        findByStatus: async () => candidates,
        deleteById: async (id: string) => {
          deleted.push(id);
          return true;
        },
      },
      resourceRepository: {
        findById: async (id: string) =>
          id === "resource-1" ? ({ id, serverId: "local" } as Resource) : null,
      },
    } as unknown as IUnitOfWork;
    const cleanupPort: DockerPreviewCleanupPort = {
      removeServiceByName: async () => {
        throw new Error("remote target unavailable");
      },
    };

    const result = await new ReconcilePreviewCleanupsUseCase(
      uow,
      cleanupPort,
      {} as CaddyServicePort,
    ).execute();

    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.cleaned).toBe(0);
    expect(deleted).toEqual([]);
  });
});
