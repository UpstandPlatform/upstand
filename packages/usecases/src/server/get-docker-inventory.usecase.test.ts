import { describe, expect, test } from "bun:test";
import { GetDockerInventoryUseCase } from "./get-docker-inventory.usecase";

function createUploadUseCase() {
  const uploads: string[] = [];
  const resource = {
    id: "resource-a",
    environmentId: "environment-a",
    name: "App A",
    appName: "app-a",
    type: "application",
    composeType: null,
  };
  const useCase = new GetDockerInventoryUseCase(
    {
      resourceRepository: {
        async findById() {
          return resource;
        },
      },
      environmentRepository: {
        async findById() {
          return { id: "environment-a", projectId: "project-a" };
        },
      },
      projectRepository: {
        async findById() {
          return { id: "project-a", organizationId: "organization-a" };
        },
      },
    } as never,
    {
      async listContainers() {
        return [
          {
            id: "container-a-full",
            name: "app-a",
            image: "app:a",
            state: "running",
            status: "running",
            ports: "",
            mounts: [],
            networks: [],
            labels: ["com.upstand.resource-id=resource-a"],
            createdAt: null,
          },
          {
            id: "container-b-full",
            name: "app-b",
            image: "app:b",
            state: "running",
            status: "running",
            ports: "",
            mounts: [],
            networks: [],
            labels: ["com.upstand.resource-id=resource-b"],
            createdAt: null,
          },
        ];
      },
    } as never,
    {} as never,
    {} as never,
    {
      async uploadArchiveToContainer(_target: unknown, containerId: string) {
        uploads.push(containerId);
        return { success: true };
      },
    } as never,
  );

  return { uploads, useCase };
}

describe("GetDockerInventoryUseCase upload authorization", () => {
  test("rejects a container belonging to another resource", async () => {
    const { uploads, useCase } = createUploadUseCase();

    await expect(
      useCase.uploadContainer(
        {
          organizationId: "organization-a",
          resourceId: "resource-a",
          containerId: "container-b",
          destination: "/",
        },
        Buffer.from("archive"),
      ),
    ).rejects.toThrow("Container is not part of the requested resource");
    expect(uploads).toEqual([]);
  });

  test("uses the explicitly authorized full container ID for archive upload", async () => {
    const { uploads, useCase } = createUploadUseCase();

    await useCase.uploadContainer(
      {
        organizationId: "organization-a",
        resourceId: "resource-a",
        containerId: "container-a-full",
        destination: "/",
      },
      Buffer.from("archive"),
    );

    expect(uploads).toEqual(["container-a-full"]);
  });

  test("rejects a container upload directed at another server", async () => {
    const { uploads, useCase } = createUploadUseCase();

    await expect(
      useCase.uploadContainer(
        {
          organizationId: "organization-a",
          resourceId: "resource-a",
          serverId: "server-b",
          containerId: "container-a-full",
          destination: "/",
        },
        Buffer.from("archive"),
      ),
    ).rejects.toThrow(
      "Docker target is not assigned to the requested resource",
    );
    expect(uploads).toEqual([]);
  });
});
