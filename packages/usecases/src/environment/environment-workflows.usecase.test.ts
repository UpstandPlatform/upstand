import { describe, expect, test } from "bun:test";
import type { Environment, Resource } from "@upstand/domain";
import { serializeResourceEnvironmentVariables } from "../resource/resource-environment";
import {
  CloneEnvironmentUseCase,
  DiffEnvironmentsUseCase,
  PromoteEnvironmentUseCase,
} from "./environment-workflows.usecase";

process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 9).toString("base64");

function environment(
  id: string,
  overrides: Partial<Environment> = {},
): Environment {
  return {
    id,
    projectId: "project-1",
    name: id,
    slug: id,
    description: null,
    isDefault: false,
    isProtected: false,
    resourceCount: 0,
    envVars: serializeResourceEnvironmentVariables({ PROJECT_TOKEN: id }),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    inheritsVariables: overrides.inheritsVariables ?? false,
  };
}

function resource(
  id: string,
  environmentId: string,
  overrides: Partial<Resource> = {},
): Resource {
  return {
    id,
    environmentId,
    name: "Web",
    type: "application",
    status: "running",
    provider: "github",
    appName: "web-prod",
    description: null,
    credentials: "encrypted-credentials",
    buildSecrets: "encrypted-build-secrets",
    buildConfig: JSON.stringify({ type: "dockerfile", buildPath: "." }),
    advancedConfig: "{}",
    envVars: serializeResourceEnvironmentVariables({ APP_TOKEN: id }),
    domains: JSON.stringify([{ host: `${id}.example.com` }]),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("environment workflows", () => {
  test("clones with a unique slug and strips secrets by default", async () => {
    const source = environment("production", {
      projectId: "project-1",
      slug: "production",
    });
    const existing = environment("existing", { slug: "qa-environment" });
    const sourceResource = resource("resource-1", source.id);
    const environments = [source, existing];
    const resources = [sourceResource];
    const createdResourcePatches: Record<string, unknown>[] = [];
    const environmentRepository = {
      findById: async (id: string) =>
        environments.find((candidate) => candidate.id === id) ?? null,
      findByProjectId: async () => environments,
      create: async (data: Record<string, unknown>) => {
        const created = environment(
          String(data.id),
          data as Partial<Environment>,
        );
        environments.push(created);
        return created;
      },
      updateEnvironment: async (id: string, patch: Partial<Environment>) => {
        const current = environments.find((candidate) => candidate.id === id);
        if (!current) return null;
        Object.assign(current, patch);
        return current;
      },
      updateById: async (id: string, patch: Partial<Environment>) => {
        const current = environments.find((candidate) => candidate.id === id);
        if (!current) return null;
        Object.assign(current, patch);
        return current;
      },
    };
    const resourceRepository = {
      findByEnvironmentId: async (environmentId: string) =>
        resources.filter(
          (candidate) => candidate.environmentId === environmentId,
        ),
      create: async (data: Record<string, unknown>) => {
        createdResourcePatches.push(data);
        const created = resource(
          String(data.id),
          String(data.environmentId),
          data as Partial<Resource>,
        );
        resources.push(created);
        return created;
      },
    };
    const uow = {
      environmentRepository,
      resourceRepository,
      transaction: async (work: (tx: never) => Promise<unknown>) =>
        work(uow as never),
    };

    const created = await new CloneEnvironmentUseCase(uow as never).execute({
      sourceEnvironmentId: source.id,
      name: "QA Environment!",
      includeResources: true,
      includeSecrets: false,
    });

    expect(created.slug).toBe("qa-environment-2");
    expect(created.inheritsVariables).toBe(false);
    expect(createdResourcePatches).toHaveLength(1);
    expect(createdResourcePatches[0]).toMatchObject({
      credentials: "{}",
      buildSecrets: null,
      envVars: "{}",
      domains: "[]",
      appName: "web-prod-qa-environment-2",
    });
  });

  test("returns a redacted diff that still identifies variable and resource changes", async () => {
    const source = environment("source", {
      envVars: serializeResourceEnvironmentVariables({
        SHARED: "one",
        ONLY_SOURCE: "secret",
      }),
    });
    const target = environment("target", {
      envVars: serializeResourceEnvironmentVariables({
        SHARED: "two",
        ONLY_TARGET: "private",
      }),
    });
    const sourceResource = resource("source-resource", source.id, {
      envVars: serializeResourceEnvironmentVariables({ APP_MODE: "source" }),
    });
    const targetResource = resource("target-resource", target.id, {
      envVars: serializeResourceEnvironmentVariables({ APP_MODE: "target" }),
      credentials: "different-credentials",
    });
    const uow = {
      environmentRepository: {
        findById: async (id: string) =>
          id === source.id ? source : id === target.id ? target : null,
        findAncestors: async (id: string) => [
          id === source.id ? source : target,
        ],
      },
      resourceRepository: {
        findByEnvironmentId: async (id: string) =>
          id === source.id ? [sourceResource] : [targetResource],
      },
    };

    const diff = await new DiffEnvironmentsUseCase(uow as never).execute({
      sourceEnvironmentId: source.id,
      targetEnvironmentId: target.id,
    });

    expect(diff.variables).toEqual([
      {
        key: "ONLY_SOURCE",
        source: "present",
        target: "absent",
        sensitive: true,
      },
      {
        key: "ONLY_TARGET",
        source: "absent",
        target: "present",
        sensitive: true,
      },
      { key: "SHARED", source: "present", target: "present", sensitive: true },
    ]);
    expect(JSON.stringify(diff)).not.toContain("ONLY_SOURCE_VALUE");
    expect(JSON.stringify(diff)).not.toContain("private");
    expect(diff.resources).toEqual([
      {
        key: "web",
        source: "present",
        target: "present",
        action: "update",
        changed: true,
        secretsChanged: true,
      },
    ]);
  });

  test("reports missing and target-only resources without treating them as applied", async () => {
    const source = environment("source");
    const target = environment("target");
    const sourceOnly = resource("source-only", source.id, { name: "API" });
    const targetOnly = resource("target-only", target.id, { name: "Worker" });
    const uow = {
      environmentRepository: {
        findById: async (id: string) =>
          id === source.id ? source : id === target.id ? target : null,
        findAncestors: async (id: string) => [
          id === source.id ? source : target,
        ],
      },
      resourceRepository: {
        findByEnvironmentId: async (id: string) =>
          id === source.id ? [sourceOnly] : [targetOnly],
      },
    };

    const diff = await new DiffEnvironmentsUseCase(uow as never).execute({
      sourceEnvironmentId: source.id,
      targetEnvironmentId: target.id,
    });

    expect(diff.resources).toEqual([
      {
        key: "api",
        source: "present",
        target: "absent",
        action: "add",
        changed: true,
        secretsChanged: false,
      },
      {
        key: "worker",
        source: "absent",
        target: "present",
        action: "remove",
        changed: true,
        secretsChanged: false,
      },
    ]);
  });

  test("refuses promotion into a protected environment before changing it", async () => {
    const source = environment("source");
    const target = environment("target", { isProtected: true });
    let updateCount = 0;
    const uow = {
      environmentRepository: {
        findById: async (id: string) => (id === source.id ? source : target),
        updateEnvironment: async () => {
          updateCount += 1;
          return target;
        },
      },
      resourceRepository: { findByEnvironmentId: async () => [] },
      transaction: async (work: (tx: never) => Promise<unknown>) =>
        work(uow as never),
    };

    await expect(
      new PromoteEnvironmentUseCase(uow as never).execute({
        sourceEnvironmentId: source.id,
        targetEnvironmentId: target.id,
        includeResources: true,
        includeSecrets: true,
      }),
    ).rejects.toThrow(
      "Protected environments require an explicit deployment approval",
    );
    expect(updateCount).toBe(0);
  });
});
