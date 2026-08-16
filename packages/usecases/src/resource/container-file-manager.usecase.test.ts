import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { mockUnitOfWork } from "../testing/mock-unit-of-work";
import { ContainerFileManagerUseCase } from "./container-file-manager.usecase";

process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

describe("ContainerFileManagerUseCase", () => {
  const createContext = () => {
    const orgId = "org-123";
    const resourceId = "res-123";
    const containerId = "container-abc123456789";
    const mountPath = "/var/lib/app";
    let mounts = [
      { name: "app-data", destination: mountPath, readOnly: false },
    ];
    const calls: Array<{ method: string; args: unknown[] }> = [];

    const uow = mockUnitOfWork({
      projectRepository: {
        findById: async () => ({
          id: "proj-123",
          organizationId: orgId,
          name: "Test",
        }),
      },
      environmentRepository: {
        findById: async () => ({
          id: "env-123",
          projectId: "proj-123",
          name: "Production",
        }),
      },
      resourceRepository: {
        findById: async () => ({
          id: resourceId,
          environmentId: "env-123",
          name: "web-app",
          appName: "web-app",
          type: "application",
          serverId: "local",
        }),
      },
    });

    const fileSystem = {
      getContainerMounts: async () => mounts,
      listFiles: async (
        _target: unknown,
        _id: string,
        _mount: string,
        path: string,
      ) => [
        {
          name: "config.json",
          path: `${path === "/" ? "" : path}/config.json`,
          type: "file" as const,
          sizeBytes: 16,
          permissions: "644",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      readFile: async () => ({
        content: Buffer.from('{"key":"value"}', "utf8").toString("base64"),
      }),
      writeFile: async (...args: unknown[]) =>
        calls.push({ method: "writeFile", args }),
      createItem: async (...args: unknown[]) =>
        calls.push({ method: "createItem", args }),
      renameItem: async (...args: unknown[]) =>
        calls.push({ method: "renameItem", args }),
      deleteItem: async (...args: unknown[]) =>
        calls.push({ method: "deleteItem", args }),
      changePermissions: async (...args: unknown[]) =>
        calls.push({ method: "changePermissions", args }),
      searchFiles: async () => [],
    };
    const inventory = {
      listContainers: async () => [
        {
          id: containerId,
          name: "web-app",
          labels: ["com.upstand.resource-id=res-123"],
        },
      ],
    };
    const useCase = new ContainerFileManagerUseCase(
      uow as IUnitOfWork,
      inventory as never,
      fileSystem as never,
    );

    return {
      calls,
      containerId,
      mountPath,
      orgId,
      resourceId,
      setMounts: (value: typeof mounts) => {
        mounts = value;
      },
      useCase,
    };
  };

  test("lists files only through an explicitly selected named volume", async () => {
    const context = createContext();
    await expect(
      context.useCase.listFiles({
        organizationId: context.orgId,
        resourceId: context.resourceId,
        containerId: context.containerId,
        mountPath: context.mountPath,
        path: "/",
      }),
    ).resolves.toHaveLength(1);
  });

  test("decodes text reads from the binary-safe adapter response", async () => {
    const context = createContext();
    await expect(
      context.useCase.readFile({
        organizationId: context.orgId,
        resourceId: context.resourceId,
        containerId: context.containerId,
        mountPath: context.mountPath,
        path: "/config.json",
        encoding: "text",
      }),
    ).resolves.toMatchObject({
      content: '{"key":"value"}',
      path: "/config.json",
    });
  });

  test("writes through the adapter with a canonical base64 payload", async () => {
    const context = createContext();
    await context.useCase.writeFile({
      organizationId: context.orgId,
      resourceId: context.resourceId,
      containerId: context.containerId,
      mountPath: context.mountPath,
      path: "/config.json",
      content: "hello world",
      isBase64: false,
    });
    expect(context.calls[0]?.method).toBe("writeFile");
    expect(context.calls[0]?.args.at(-1)).toBe(
      Buffer.from("hello world", "utf8").toString("base64"),
    );
  });

  test("rejects traversal, missing mounts, and non-exact container identities", async () => {
    const context = createContext();
    await expect(
      context.useCase.listFiles({
        organizationId: context.orgId,
        resourceId: context.resourceId,
        containerId: "container-abc",
        mountPath: context.mountPath,
        path: "/",
      }),
    ).rejects.toThrow("Requested container is not part of this resource");
    await expect(
      context.useCase.listFiles({
        organizationId: context.orgId,
        resourceId: context.resourceId,
        containerId: context.containerId,
        mountPath: "/var/lib/app/../etc",
        path: "/",
      }),
    ).rejects.toThrow("unsupported path segment");
    await expect(
      context.useCase.listFiles({
        organizationId: context.orgId,
        resourceId: context.resourceId,
        containerId: context.containerId,
        mountPath: "/not-a-volume",
        path: "/",
      }),
    ).rejects.toThrow("not a named volume");
  });

  test("rejects mutations on read-only named volumes", async () => {
    const context = createContext();
    context.setMounts([
      { name: "app-data", destination: context.mountPath, readOnly: true },
    ]);
    await expect(
      context.useCase.deleteItem({
        organizationId: context.orgId,
        resourceId: context.resourceId,
        containerId: context.containerId,
        mountPath: context.mountPath,
        path: "/config.json",
      }),
    ).rejects.toThrow("mounted read-only");
  });

  test("rejects mutations targeting the volume root", async () => {
    const context = createContext();
    await expect(
      context.useCase.deleteItem({
        organizationId: context.orgId,
        resourceId: context.resourceId,
        containerId: context.containerId,
        mountPath: context.mountPath,
        path: "/",
      }),
    ).rejects.toThrow("cannot target the mount root");
  });
});
