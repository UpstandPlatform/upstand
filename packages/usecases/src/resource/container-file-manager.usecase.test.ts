import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { mockUnitOfWork } from "../testing/mock-unit-of-work";
import { ContainerFileManagerUseCase } from "./container-file-manager.usecase";

process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

describe("ContainerFileManagerUseCase", () => {
  const createMockContext = () => {
    const mockOrgId = "org-123";
    const mockProjectId = "proj-123";
    const mockEnvId = "env-123";
    const mockResourceId = "res-123";
    let commandFailure = false;
    let containers = [
      {
        id: "container-abc123456",
        labels: ["com.docker.swarm.service.name=web-app"],
      },
    ];

    const uow = mockUnitOfWork({
      projectRepository: {
        findById: async (id: string) =>
          id === mockProjectId
            ? {
                id: mockProjectId,
                organizationId: mockOrgId,
                name: "Test Proj",
              }
            : null,
      },
      environmentRepository: {
        findById: async (id: string) =>
          id === mockEnvId
            ? { id: mockEnvId, projectId: mockProjectId, name: "Production" }
            : null,
      },
      resourceRepository: {
        findById: async (id: string) =>
          id === mockResourceId
            ? {
                id: mockResourceId,
                environmentId: mockEnvId,
                name: "web-app",
                appName: "web-app",
                type: "application",
                serverId: "local",
              }
            : null,
      },
    });

    const mockDockerExec = {
      execContainerCommand: async (
        _target: unknown,
        _containerId: string,
        command: string,
      ) => {
        if (commandFailure) {
          return { output: "", stderr: "permission denied", exitCode: 1 };
        }
        if (command.includes("for f in")) {
          return {
            output:
              "file|1024|644|1753400000|config.json\ndirectory|4096|755|1753400000|src",
          };
        }
        if (command.includes("cat ")) {
          return {
            output: '{"key":"value"}',
          };
        }
        if (command.includes("find")) {
          return {
            output: "/app/config.json\n/app/src/index.ts",
          };
        }
        return { output: "" };
      },
    };

    const mockDockerInventory = {
      listContainers: async () => containers,
    };

    const useCase = new ContainerFileManagerUseCase(
      uow as IUnitOfWork,
      mockDockerExec as never,
      mockDockerInventory as never,
    );

    return {
      useCase,
      mockOrgId,
      mockResourceId,
      setCommandFailure: (value: boolean) => {
        commandFailure = value;
      },
      setContainers: (value: typeof containers) => {
        containers = value;
      },
    };
  };

  test("listFiles returns formatted directory items", async () => {
    const { useCase, mockOrgId, mockResourceId } = createMockContext();
    const items = await useCase.listFiles({
      organizationId: mockOrgId,
      resourceId: mockResourceId,
      path: "/",
    });

    expect(items.length).toBe(2);
    expect(items[0]?.name).toBe("src");
    expect(items[0]?.type).toBe("directory");
    expect(items[1]?.name).toBe("config.json");
    expect(items[1]?.type).toBe("file");
  });

  test("recognizes containers managed with the Docker resource label", async () => {
    const { useCase, mockOrgId, mockResourceId, setContainers } =
      createMockContext();
    setContainers([
      {
        id: "container-managed-by-label",
        labels: ["com.upstand.resource-id=res-123"],
      },
    ]);

    const items = await useCase.listFiles({
      organizationId: mockOrgId,
      resourceId: mockResourceId,
      path: "/",
    });

    expect(items).toHaveLength(2);
  });

  test("listFiles returns an empty directory when the resource is not running", async () => {
    const { useCase, mockOrgId, mockResourceId, setContainers } =
      createMockContext();
    setContainers([]);

    expect(
      await useCase.listFiles({
        organizationId: mockOrgId,
        resourceId: mockResourceId,
        path: "/",
      }),
    ).toEqual([]);
  });

  test("readFile retrieves file contents", async () => {
    const { useCase, mockOrgId, mockResourceId } = createMockContext();
    const file = await useCase.readFile({
      organizationId: mockOrgId,
      resourceId: mockResourceId,
      path: "/config.json",
      encoding: "text",
    });

    expect(file.content).toBe('{"key":"value"}');
    expect(file.path).toBe("/config.json");
  });

  test("writeFile successfully executes base64 decoded write", async () => {
    const { useCase, mockOrgId, mockResourceId } = createMockContext();
    const res = await useCase.writeFile({
      organizationId: mockOrgId,
      resourceId: mockResourceId,
      path: "/config.json",
      content: "hello world",
    });

    expect(res.success).toBe(true);
  });

  test("createItem successfully creates file or folder", async () => {
    const { useCase, mockOrgId, mockResourceId } = createMockContext();
    const folderRes = await useCase.createItem({
      organizationId: mockOrgId,
      resourceId: mockResourceId,
      parentPath: "/",
      name: "dist",
      type: "directory",
    });

    expect(folderRes.success).toBe(true);
  });

  test("deleteItem removes path", async () => {
    const { useCase, mockOrgId, mockResourceId } = createMockContext();
    const delRes = await useCase.deleteItem({
      organizationId: mockOrgId,
      resourceId: mockResourceId,
      path: "/dist",
    });

    expect(delRes.success).toBe(true);
  });

  test("deleteItem rejects deleting root or system directories", async () => {
    const { useCase, mockOrgId, mockResourceId } = createMockContext();
    expect(
      useCase.deleteItem({
        organizationId: mockOrgId,
        resourceId: mockResourceId,
        path: "/",
      }),
    ).rejects.toThrow(
      "Deletion of system root or system directory is forbidden for security.",
    );

    expect(
      useCase.deleteItem({
        organizationId: mockOrgId,
        resourceId: mockResourceId,
        path: "/etc",
      }),
    ).rejects.toThrow("protected system path");
  });

  test("changePermissions modifies permissions and rejects invalid modes or system paths", async () => {
    const { useCase, mockOrgId, mockResourceId } = createMockContext();
    const res = await useCase.changePermissions({
      organizationId: mockOrgId,
      resourceId: mockResourceId,
      path: "/var/log/app.log",
      mode: "0755",
    });
    expect(res.success).toBe(true);

    expect(
      useCase.changePermissions({
        organizationId: mockOrgId,
        resourceId: mockResourceId,
        path: "/var/log/app.log",
        mode: "invalid",
      }),
    ).rejects.toThrow("Permission mode must be an octal string");

    expect(
      useCase.changePermissions({
        organizationId: mockOrgId,
        resourceId: mockResourceId,
        path: "/etc",
        mode: "0777",
      }),
    ).rejects.toThrow("protected system path");
  });

  test("rejects a requested container that is not owned by the resource", async () => {
    const { useCase, mockOrgId, mockResourceId } = createMockContext();
    expect(
      useCase.listFiles({
        organizationId: mockOrgId,
        resourceId: mockResourceId,
        containerId: "another-container",
        path: "/",
      }),
    ).rejects.toThrow("Requested container is not part of this resource.");
  });

  test("rejects protected writes and path-based item names", async () => {
    const { useCase, mockOrgId, mockResourceId } = createMockContext();

    expect(
      useCase.writeFile({
        organizationId: mockOrgId,
        resourceId: mockResourceId,
        path: "/etc/secret",
        content: "nope",
      }),
    ).rejects.toThrow("protected system path");

    expect(
      useCase.createItem({
        organizationId: mockOrgId,
        resourceId: mockResourceId,
        parentPath: "/app",
        name: "../escape",
        type: "file",
      }),
    ).rejects.toThrow("invalid path characters");

    expect(
      useCase.renameItem({
        organizationId: mockOrgId,
        resourceId: mockResourceId,
        oldPath: "/app/config.json",
        newPath: "/etc/config.json",
      }),
    ).rejects.toThrow("protected system path");
  });

  test("surfaces container command failures instead of reporting success", async () => {
    const { useCase, mockOrgId, mockResourceId, setCommandFailure } =
      createMockContext();
    setCommandFailure(true);

    expect(
      useCase.writeFile({
        organizationId: mockOrgId,
        resourceId: mockResourceId,
        path: "/app/config.json",
        content: "updated",
      }),
    ).rejects.toThrow("permission denied");
  });

  test("renameItem renames file or directory", async () => {
    const { useCase, mockOrgId, mockResourceId } = createMockContext();
    const res = await useCase.renameItem({
      organizationId: mockOrgId,
      resourceId: mockResourceId,
      oldPath: "/app/old-config.json",
      newPath: "/app/new-config.json",
    });

    expect(res.success).toBe(true);
  });

  test("writeFile handles isBase64 flag directly", async () => {
    const { useCase, mockOrgId, mockResourceId } = createMockContext();
    const res = await useCase.writeFile({
      organizationId: mockOrgId,
      resourceId: mockResourceId,
      path: "/image.png",
      content:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      isBase64: true,
    });

    expect(res.success).toBe(true);
  });

  test("searchFiles returns matching items", async () => {
    const { useCase, mockOrgId, mockResourceId } = createMockContext();
    const results = await useCase.searchFiles({
      organizationId: mockOrgId,
      resourceId: mockResourceId,
      path: "/app",
      query: "config",
    });

    expect(results.length).toBe(2);
    expect(results[0]?.name).toBe("config.json");
  });

  test("searchFiles returns no matches when the resource is not running", async () => {
    const { useCase, mockOrgId, mockResourceId, setContainers } =
      createMockContext();
    setContainers([]);

    expect(
      await useCase.searchFiles({
        organizationId: mockOrgId,
        resourceId: mockResourceId,
        path: "/",
        query: "config",
      }),
    ).toEqual([]);
  });

  test("rejects access when resource belongs to another organization", async () => {
    const { useCase, mockResourceId } = createMockContext();
    expect(
      useCase.listFiles({
        organizationId: "other-org-999",
        resourceId: mockResourceId,
        path: "/",
      }),
    ).rejects.toThrow("Resource is not part of the active organization.");
  });
});
