import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { ExecContainerCommandUseCase } from "./exec-container-command.usecase";

function createUow() {
  return {
    resourceRepository: {
      findById: async () => ({
        id: "resource-1",
        environmentId: "environment-1",
        type: "application",
        name: "Resource 1",
        appName: "resource-1",
        composeType: null,
        serverId: "local",
      }),
    },
    environmentRepository: {
      findById: async () => ({ projectId: "project-1" }),
    },
    projectRepository: {
      findById: async () => ({ organizationId: "org-2" }),
    },
    serverRepository: { findById: async () => null },
  } as unknown as IUnitOfWork;
}

describe("container command authorization", () => {
  test("rejects a resource belonging to another organization", async () => {
    const docker = {
      execContainerCommand: async () => ({ output: "should not run" }),
    };
    const useCase = new ExecContainerCommandUseCase(
      createUow(),
      docker as never,
      { listContainers: async () => [] } as never,
    );

    await expect(
      useCase.execute({
        organizationId: "org-1",
        resourceId: "resource-1",
        containerId: "container-1",
        command: "id",
      }),
    ).rejects.toThrow("Resource is not part of the active organization");
  });

  test("verifies the selected container belongs to the resource", async () => {
    const docker = {
      execContainerCommand: async () => ({ output: "should not run" }),
    };
    const inventory = {
      listContainers: async () => [
        {
          id: "container-1",
          labels: ["com.docker.swarm.service.name=resource-1"],
        },
      ],
    };
    const uow = createUow();
    (uow.projectRepository.findById as unknown as () => Promise<unknown>) =
      async () => ({ organizationId: "org-1" });
    const useCase = new ExecContainerCommandUseCase(
      uow,
      docker as never,
      inventory as never,
    );

    await expect(
      useCase.execute({
        organizationId: "org-1",
        resourceId: "resource-1",
        containerId: "other-container",
        command: "id",
      }),
    ).rejects.toThrow("Container is not part of the requested resource");
  });
});
