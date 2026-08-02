import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { GetAccountStatusUseCase } from "./get-account-status.usecase";

describe("GetAccountStatusUseCase", () => {
  test("keeps organization topology reads bounded as the project count grows", async () => {
    let activeEnvironmentReads = 0;
    let maxEnvironmentReads = 0;
    let activeResourceReads = 0;
    let maxResourceReads = 0;

    const uow = {
      projectRepository: {
        findByOrganizationId: async () =>
          Array.from({ length: 40 }, (_, index) => ({
            id: `project-${index}`,
          })),
      },
      serverRepository: {
        findByOrganizationId: async () => [],
      },
      environmentRepository: {
        findByProjectId: async (projectId: string) => {
          activeEnvironmentReads += 1;
          maxEnvironmentReads = Math.max(
            maxEnvironmentReads,
            activeEnvironmentReads,
          );
          await Bun.sleep(1);
          activeEnvironmentReads -= 1;
          return [{ id: `environment-${projectId}`, projectId }];
        },
      },
      resourceRepository: {
        findByEnvironmentId: async (environmentId: string) => {
          activeResourceReads += 1;
          maxResourceReads = Math.max(maxResourceReads, activeResourceReads);
          await Bun.sleep(1);
          activeResourceReads -= 1;
          return [{ id: `resource-${environmentId}`, environmentId }];
        },
      },
      deploymentRepository: {
        findRecentByResourceIds: async () => [],
      },
    } as unknown as IUnitOfWork;

    const status = await new GetAccountStatusUseCase(uow).execute({
      organizationId: "org-1",
    });

    expect(status.projectCount).toBe(40);
    expect(status.environmentCount).toBe(40);
    expect(status.resourceCount).toBe(40);
    expect(maxEnvironmentReads).toBeLessThanOrEqual(16);
    expect(maxResourceReads).toBeLessThanOrEqual(16);
  });
});
