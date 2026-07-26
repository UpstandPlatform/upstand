import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import {
  CreateTemplateUseCase,
  DeployTemplateInputSchema,
  DeployTemplateUseCase,
} from "./template.usecases";

describe("template catalog use cases", () => {
  test("rejects Compose documents without services", async () => {
    const useCase = new CreateTemplateUseCase({
      templateRepository: { create: async () => null },
    } as unknown as IUnitOfWork);

    await expect(
      useCase.execute({
        organizationId: "org-1",
        name: "invalid",
        tags: [],
        composeFile: "version: '3.9'",
      }),
    ).rejects.toThrow("at least one service");
  });

  test("rejects templates that request host-level Docker access", async () => {
    const useCase = new CreateTemplateUseCase({
      templateRepository: { create: async () => null },
    } as unknown as IUnitOfWork);

    await expect(
      useCase.execute({
        organizationId: "org-1",
        name: "unsafe",
        tags: [],
        composeFile:
          "services:\n  app:\n    image: nginx:alpine\n    privileged: true",
      }),
    ).rejects.toThrow("host-level isolation");

    await expect(
      useCase.execute({
        organizationId: "org-1",
        name: "relative-bind",
        tags: [],
        composeFile:
          "services:\n  app:\n    image: nginx:alpine\n    volumes:\n      - ./data:/data",
      }),
    ).rejects.toThrow("host bind");
  });

  test("deploys a template as an isolated raw Compose resource", async () => {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    let createInput: Record<string, unknown> | undefined;
    let deployedId = "";
    const created = { id: "resource-1" };
    const uow = {
      templateRepository: {
        findById: async () => ({
          id: "template-1",
          organizationId: "org-1",
          name: "Nginx",
          description: null,
          tags: ["web"],
          composeFile: "services:\n  web:\n    image: nginx:alpine",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
      environmentRepository: {
        findById: async () => ({ projectId: "project-1" }),
      },
      projectRepository: {
        findById: async () => ({ organizationId: "org-1" }),
      },
      resourceRepository: {
        updateById: async (id: string, patch: Record<string, unknown>) => {
          updates.push({ id, patch });
          return null;
        },
      },
    } as unknown as IUnitOfWork;
    const useCase = new DeployTemplateUseCase(
      uow,
      {
        execute: async (input: Record<string, unknown>) => {
          createInput = input;
          return created;
        },
      } as never,
      {
        execute: async ({ id }: { id: string }) => {
          deployedId = id;
          return created;
        },
      } as never,
    );

    await useCase.execute(
      DeployTemplateInputSchema.parse({
        organizationId: "org-1",
        templateId: "template-1",
        environmentId: "environment-1",
        resourceName: "Nginx app",
        appName: "nginx-app",
        randomize: true,
      }),
    );

    expect(createInput?.type).toBe("compose");
    expect(JSON.parse(String(createInput?.credentials))).toMatchObject({
      provider: "raw",
      composeFile: expect.stringContaining("nginx:alpine"),
    });
    expect(updates).toHaveLength(1);
    expect(String(updates[0]?.patch.advancedConfig)).toContain(
      '"randomize":true',
    );
    expect(deployedId).toBe("resource-1");
  });

  test("deploys a built-in blueprint without requiring an organization template row", async () => {
    let createInput: Record<string, unknown> | undefined;
    const uow = {
      environmentRepository: {
        findById: async () => ({ projectId: "project-1" }),
      },
      projectRepository: {
        findById: async () => ({ organizationId: "org-1" }),
      },
      resourceRepository: { updateById: async () => null },
    } as unknown as IUnitOfWork;
    const useCase = new DeployTemplateUseCase(
      uow,
      {
        execute: async (input: Record<string, unknown>) => {
          createInput = input;
          return { id: "resource-remote" };
        },
      } as never,
      { execute: async () => ({ id: "resource-remote" }) } as never,
      () => ({
        id: "ackee",
        name: "Ackee",
        version: "latest",
        description: "",
        logo: "",
        links: {},
        tags: [],
        variables: {},
        composeFile: "services:\n  ackee:\n    image: electerious/ackee:3.4.2",
        source: "builtin" as const,
      }),
    );

    await useCase.execute({
      organizationId: "org-1",
      templateId: "ackee",
      source: "builtin",
      environmentId: "environment-1",
      resourceName: "Ackee",
      appName: "ackee",
      composeType: "stack",
      randomize: false,
    });

    expect(JSON.parse(String(createInput?.credentials))).toMatchObject({
      composeFile: expect.stringContaining("electerious/ackee:3.4.2"),
    });
  });
});
